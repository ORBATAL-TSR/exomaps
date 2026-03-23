import _React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// StrictMode intentionally disabled — it double-invokes effects in dev which
// creates two WebGL contexts simultaneously, exhausting GPU memory and causing
// context loss before the orrery even renders.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
