import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Aliased to workspace-relay-prototype.jsx at the repo root (see vite.config.js).
import App from '@prototype';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
