import type { ProductRecord, CreateProductBody, ClaimReasonRecord, CreateClaimReasonBody, NoteRecord, CreateNoteBody } from '../../../shared/types';
import { modelIdFromName, serialHash, reasonHash, noteHash } from '../shared';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    const code = String(body.error || 'unavailable');
    const messages: Record<string, string> = {
      empty_field: 'A required field is empty.', invalid_body: 'The service could not accept these fields. Check IDs and text.',
      serial_exists: 'This serial is already stored. Its existing record must match before registration can continue.',
      not_found: 'No off-chain record is available for this hash.', internal_error: 'The service could not save the record. Please retry later.',
      unavailable: 'The off-chain service is unavailable. Start it on port 3001 and retry.',
      invalid_response: 'The service returned an unexpected response.',
    };
    super(messages[code] || 'The off-chain service rejected this request.');
    this.name = 'ApiError'; this.code = code; this.status = status; this.body = body;
  }
}
export function createApi(baseUrl: string) {
  const root = baseUrl.replace(/\/$/, '');
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, {once: true});
    const timer = globalThis.setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(0, { error: 'unavailable' });
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new ApiError(response.status, { error: 'invalid_response' }); }
    if (!response.ok) throw new ApiError(response.status, (data && typeof data === 'object' ? data : { error: 'invalid_response' }) as Record<string, unknown>);
    return data as T;
  }
  const getProductMetadata = (hash: string, signal?: AbortSignal) => request<ProductRecord>(`/products/${encodeURIComponent(hash.toLowerCase())}`, undefined, signal);
  return {
    health: (signal?: AbortSignal) => request<{ok: boolean}>('/health', undefined, signal),
    getProductMetadata,
    async createProduct(body: CreateProductBody): Promise<ProductRecord> {
      const expectedHash = serialHash(body.serial);
      const expectedModel = modelIdFromName(body.modelName);
      let data: ProductRecord;
      try { data = await request<ProductRecord>('/products', body); }
      catch (error) {
        // A previous wallet cancellation leaves plaintext intentionally persisted.
        // A retry may reuse it only if its full meaning matches this form.
        if (!(error instanceof ApiError) || error.code !== 'serial_exists') throw error;
        const existing = await getProductMetadata(expectedHash);
        if (existing.serialHash.toLowerCase() !== expectedHash.toLowerCase() || existing.modelId !== expectedModel || existing.modelName !== body.modelName.trim() || existing.description !== (body.description ?? '')) {
          throw new Error('The existing serial belongs to different product details. Use its original model/description or a new serial.');
        }
        data = existing;
      }
      if (data.serialHash.toLowerCase() !== expectedHash.toLowerCase() || data.modelId !== expectedModel || data.modelName !== body.modelName.trim() || data.description !== (body.description ?? '')) throw new Error('Stored product details do not match the shared hashing rules and input. Registration stopped.');
      return data;
    },
    async createReason(body: CreateClaimReasonBody): Promise<ClaimReasonRecord> {
      const result = await request<ClaimReasonRecord>('/claims', body);
      if (result.productId !== body.productId || result.reasonText !== body.reasonText || result.reasonHash.toLowerCase() !== reasonHash(body.reasonText).toLowerCase()) throw new Error('Stored fault hash does not match this request. Submission stopped.');
      return result;
    },
    getReason: (hash: string, productId: string, signal?: AbortSignal) => request<ClaimReasonRecord>(`/claims/${encodeURIComponent(hash.toLowerCase())}?productId=${encodeURIComponent(productId)}`, undefined, signal),
    async createNote(body: CreateNoteBody): Promise<NoteRecord> {
      const result = await request<NoteRecord>('/notes', body);
      if (result.noteText !== body.noteText || result.noteHash.toLowerCase() !== noteHash(body.noteText).toLowerCase()) throw new Error('Stored service-note hash does not match this note. Resolution stopped.');
      return result;
    },
    getNote: (hash: string, signal?: AbortSignal) => request<NoteRecord>(`/notes/${encodeURIComponent(hash.toLowerCase())}`, undefined, signal),
  };
}
