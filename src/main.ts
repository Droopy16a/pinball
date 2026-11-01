import { mount } from 'svelte';
import App from './App.svelte';
import './styles/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('Application mount element is missing.');
const app = mount(App, { target });
export default app;
