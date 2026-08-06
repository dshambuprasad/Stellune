import './style.css';
import { mountApp } from './app/index.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Cosmophony: #app container is missing from index.html');
}
mountApp(root);
