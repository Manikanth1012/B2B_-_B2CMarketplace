import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles/global.css'
import './styles/ui.css'
import './styles/console.css'
import './styles/console-partner-enterprise.css'
import './styles/product-detail.css'
import './styles/enterprise-storefront.css'
import './styles/checkout.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
