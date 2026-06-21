import React from 'react'
import ReactDOM from 'react-dom/client'
import './globals.css'
import App from './App'
import { AgentNodeEditor, Container, type Project } from "openchad-react"
import BrowserApp from './BrowserApp'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { Layers } from 'lucide-react'

// Configure Monaco workers to use local bundled files (CDN is blocked by CSP)
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}


loader.config({ monaco })

const Apps: Project = {
  projectName: "OpenBrowser",
  projectIcon: () => <Layers className='w-5 h-5'/>,
  defaultTab: {
    layout: "single",
    icon: "Compass",
    tabs: [
      {
        appname: "main-app",
        data: {},
        App: BrowserApp,
      },
    ],
  },
  size: [50],
  appRegistry: {
    "agent": AgentNodeEditor 
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <Container Apps={Apps} />
</React.StrictMode>)