import { render } from 'preact';
import { App } from './app';
import { locale } from './lib/i18n';
import { applyTheme } from './lib/theme';
import './styles/index.css';

applyTheme();
document.documentElement.lang = locale.value;

const root = document.getElementById('app');
if (root) render(<App />, root);
