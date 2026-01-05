import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Note: StrictMode disabled because transferControlToOffscreen() can only be
// called once per canvas element, and StrictMode's double-invocation breaks this.
createRoot(document.getElementById('root')).render(<App />)
