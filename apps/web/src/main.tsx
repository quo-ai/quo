import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// First, so the browser's install-prompt event (fired early) is never missed.
import './install';
import { App } from './App';
import { isDesktopApp } from './platform';
import './styles/index.css';
import { applyAppearance } from './theme';

// The page title is the desktop app's window title.
if (isDesktopApp()) document.title = 'Quo';

applyAppearance(); // before the first render, so the chosen look is there from the start

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
