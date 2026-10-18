import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// First, so the browser's install-prompt event (fired early) is never missed.
import './install';
import { App } from './App';
import { isDesktopApp } from './platform';
import './styles/index.css';

// The page title is the desktop app's window title.
if (isDesktopApp()) document.title = 'Quo';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
