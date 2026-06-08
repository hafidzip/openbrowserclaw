import React from 'react'
import ReactDOM from 'react-dom/client'
import './globals.css'
import App from './App'
import { Container, OpenChadIcon, type Project } from "openchad-react"

const Apps: Project = {
  projectName: "OpenBrowser",
  projectIcon: OpenChadIcon,
  defaultTab: {
    layout: "single",
    icon: "default",
    tabs: [
      {
        appname: "main-app",
        data: {},
        App: App,
      },
    ],
  },
  size: [50],
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Container Apps={Apps} />
  </React.StrictMode>,
)