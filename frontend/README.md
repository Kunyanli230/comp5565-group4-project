# Origin product passport frontend

COMP5565 Group 4 的前端部分。Vite、React、TypeScript、ethers v6；包含概览、产品登记、转让、真伪验证、保修申请、服务中心审批和产品事件时间线。业务数据来自本地合约与现有 HTTP API，不使用浏览器模拟历史。

## 快速开始

使用 Node.js 24 LTS 和 npm。在仓库根目录安装原项目依赖，再安装前端依赖：

```sh
npm ci
cd frontend
npm ci
npm run demo
```

打开 **http://127.0.0.1:5173**，保持终端运行。`demo` 会：

1. 启动 Hardhat 本地链（31337、8545），或使用已经运行的相同网络。
2. 启动现有链下服务（3001），或使用已有的健康服务。
3. 在新链或缺少部署时运行组员的部署脚本，读取 `deployments/local.json`。
4. 运行幂等种子脚本，准备默认产品和业务角色。
5. 编译并同步实际合约 ABI，再启动 Vite（5173）。

按 Ctrl+C 只停止启动器创建的服务，不终止已有的链或 API，不清空存储。重启本地链会重置链上状态；重新启动 demo 将部署并初始化新链。

本机依赖已经安装，也可在 Finder 双击 `frontend/start.command`。这个 macOS 启动器可使用已安装的 Node 或 Codex 自带的 Node；其他组员通常使用上面的 npm 命令。

## 分开启动服务

如果组员已经启动链和 API，无需再用 demo。从仓库根目录在不同终端运行：

```sh
npm run node
npm run deploy:local
npm run offchain
npm run seed:local
```

确认 API 已启动后再 seed。随后：

```sh
cd frontend
npm run dev
```

`predev` / `prebuild` 自动编译并从真实实现产物复制 ABI 到忽略的 `src/generated/`；接口实现尚未存在时可使用编译的接口 ABI。未修改共享接口或合约实现。

## 钱包与账户

公开验证、产品详情、时间线与目录无需连接钱包。交易使用 MetaMask 或其他 EIP-1193 钱包。

- 网络：Hardhat Local，chain ID **31337**，RPC **http://127.0.0.1:8545**，币种 **ETH**。
- 点击 Connect wallet。若网络不对，点击 Switch network；钱包会要求确认切换或添加本地网络。
- 使用本地节点输出的开发账户或由课程提供的本地测试账户。在钱包中切换角色；前端不会保存私钥、助记词，也不会自动签名。
- 所有交易 VALUE 均为 0；本地测试 ETH 只用于 gas。

| 角色 | 本地测试地址 |
| --- | --- |
| 管理员 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| 制造商 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| 零售商 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| 顾客 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| 服务中心 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |
| 转售买家 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` |

这些均为公开开发账户，仅用于本地演示。前端每次签名前重新检查网络和所选账户，权限也由合约再次执行。

### 交易结果核验

- 交易通知标明具体序列号、商品编号或申请编号，代表最后一次操作；开始新的提交会清掉上一笔通知。
- 签名前比较钱包和页面只读 RPC 在同一区块高度的区块哈希，避免两个不同的本地节点都使用 31337 却被当作同一条链。
- 钱包返回交易哈希后，页面独立读取本地链回执；只有对应哈希的 `status = 1` 才显示 `On-chain receipt: SUCCESS`，`status = 0` 才显示 `REVERTED`。
- 钱包或 RPC 断开、确认暂时查不到时，显示结果尚未确认并保留哈希。点击 **Verify on-chain result** 只查询已有交易，不重新发送；**Copy hash** 可复制当前交易哈希。
- **Transaction details** 显示本次账户、链 ID、出错阶段和经过过滤的节点错误，不包含请求参数、签名、私钥或钱包状态转储。
- MetaMask 扩展自身的失败通知不受网页控制；它可能对应其他账户、网络或旧记录。先核对同一哈希及商品状态，确认前不要重复提交。正式演示前完整走一遍，并保持本地链运行。

**首次钱包准备：** 一键启动器会隐藏 Hardhat 输出中的开发私钥。请查看仓库 [接口说明.md 的本地账户部分](../接口说明.md#本地账户)，在独立的测试钱包中导入其中公开的 Hardhat 测试助记词，再依次添加账户 0–5；地址应与上表逐一对应。也可先停止一键 demo，手动运行 `npm run node`，按其输出在测试钱包导入对应开发账户。只连接你的日常钱包地址不会自动获得制造商或服务中心角色。

## 页面和演示步骤

| 路由 | 用途 |
| --- | --- |
| `/` | 已登记产品、申请数量、产品目录与操作入口 |
| `/register` | 制造商先保存产品明文，再登记链上指纹、保修期限、次数和零售商 |
| `/transfer` | 当前所有者转让；待审批申请存在时显示锁定 |
| `/verify` | 大小写敏感序列号验证；校验型号指纹后显示明文 |
| `/warranty` | 当前所有者申请有效保修；先保存原始故障文本，再调用合约 |
| `/service` | 逐页读取申请，筛选待处理，保存可选维修备注，批准或拒绝 |
| `/product/:productId` | 产品详情及按产品筛选的登记、所有权和保修事件 |

第一次启动已登记 `LW-2026-0001` / `LuxeWatch X`（通常产品 1），零售商持有且保修未开始。完整演示：

1. 无钱包在 Verify 查询 `LW-2026-0001`，打开产品 passport。
2. 零售商钱包进入 Transfer，转给 demo customer。此时保修开始。
3. 顾客钱包进入 Warranty，Use demo description，然后提交。产品被锁，无法转让。
4. 服务中心钱包进入 Service，查看故障描述，Use demo note，然后 Approve repair。次数变为 1，产品解锁。
5. 顾客钱包转给 demo resale buyer。产品详情中保修开始时间保持不变。
6. Product 时间线能看到以上全部真实事件及交易哈希。

要演示登记新产品，用制造商钱包进入 Register，使用一个新序列号。种子产品的序列号已经被登记，不应再次提交。拒签后原明文可能已保存；只有型号和描述完全一致的重试才允许复用，冲突内容不会被覆盖。

## 与冻结接口的对接

- 直接读取 `shared/hash.js`、`shared/constants.js`、`shared/types.ts`。Vite 只把前两者的 CommonJS 模块语法转换为 ESM，未改写哈希算法。
- `uint256` 保持 bigint 或十进制字符串；型号 ID 不经过 `Number`。
- 序列号和型号仅 trim；故障和维修备注保留原始空格。空维修备注使用零 bytes32，不调用 POST /notes。
- 读取故障文本始终携带 `GET /claims/{reasonHash}?productId={claim.productId}`。
- 链下服务失败时仍显示链上数据，但不伪造明文；返回明文的哈希必须匹配链上指纹。
- 前端按 API 的 `error` 字段分支，区分结构化错误、拒签、回滚、账户和网络错误。
- 产品列表每页 8 条，申请每页 20 条；待处理筛选作用于当前申请页。历史每次查询 5,000 个区块，支持继续读取更早区块。
- `deployments/local.json` 在开发服务器和本地 preview 中通过 `/app-config.json` 动态读取；无部署时显示操作说明，禁止使用样例零地址。
- 生产构建会把当时的部署配置放入 `dist/app-config.json`。部署地址变化后需要重新构建；该应用面向组内本地链，不是公网链部署站点。

## 检查与构建

```sh
# 仓库根目录，冻结自检应为 2 passing
npm run check:interface

# frontend/
npm test
npm run build

# 已启动链和 API 时，对独特 QA 产品做真实链/API验收
npm run test:acceptance
```

`npm test` 包含 44 项 API、原文哈希、大整数、错误处理、未登记演示序列号选择、回执核验和钱包/RPC 区块一致性检查。`test:acceptance` 是 11 个真实链/API检查点，使用本地公开解锁账户，并新建独特 QA 产品，不改变 seed 产品。运行后目录会出现 QA 产品，这是测试结果，不是预置假数据。

构建后使用 `npm run preview`（5173）。关闭已有 dev 服务再 preview，避免端口冲突。静态部署时需要 SPA fallback 到 index.html。

## 验证范围

已验证 TypeScript、生产构建、冻结接口自检、44 项核心、演示序列号及交易诊断测试、11 个真实链/API 生命周期检查点；在浏览器检查了六个业务页面、公开验证、真实产品时间线、无钱包保护和桌面/手机布局。

浏览器测试使用无扩展的内置浏览器，未代替组员在 MetaMask 内完成整套签名演示。正式课堂演示前，应按上面的账户顺序在装有 MetaMask 的浏览器走一遍；真实链/API验收不等同于钱包弹窗兼容性验收。

## 文件边界与开源来源

交付改动均位于 `frontend/`。根 package-lock、冻结 shared、合约和其他组员文件保持不变。依赖来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。页面和业务实现为本项目编写，没有复制未知来源的业务模板。

本地开发分支为 `codex/frontend`。将 `frontend/` 的源文件和 package-lock.json 一起提交；不要提交 node_modules、dist、src/generated、deployments/local.json 或 offchain/data.json。
