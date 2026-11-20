import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { DappProvider } from './context/DappContext';
import App from './App';
import './styles.css';
import './premium.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><DappProvider><App /></DappProvider></BrowserRouter></React.StrictMode>,
);
