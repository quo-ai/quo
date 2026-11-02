import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// First, so the browser's install-prompt event (fired early) is never missed.
import './install';
import { App } from './App';
import { isDesktopApp } from './platform';
import './styles/index.css';
import { applyAppearance } from './theme';
import { rememberInvite } from './cloud/invite';

// The page title is the desktop app's window title.
if (isDesktopApp()) document.title = 'Quo';

applyAppearance(); // before the first render, so the chosen look is there from the start
rememberInvite(); // an invite link's code, kept until sign-in

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
