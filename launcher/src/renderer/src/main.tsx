import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Élément #root introuvable')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
