import type { ComponentChildren } from 'preact';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: ComponentChildren }) {
  return (
    <div class="o-app">
      <Sidebar />
      <main class="c-main" id="main">
        {children}
      </main>
    </div>
  );
}
