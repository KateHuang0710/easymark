import React, { Component, ReactNode } from 'react'
import { en } from '../i18n/en'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  locale: 'en' | 'zh'
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, locale: 'en' }
  }

  static getDerivedStateFromError(error: Error): State {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('easymark-locale') : null
    return { hasError: true, error, locale: saved === 'zh' ? 'zh' : 'en' }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      const isZh = this.state.locale === 'zh'
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', padding: 40,
          fontFamily: 'system-ui, sans-serif', color: '#333',
        }}>
          <h2 style={{ marginBottom: 12 }}>{isZh ? '出了点问题' : 'Something went wrong'}</h2>
          <p style={{ marginBottom: 8, color: '#666', textAlign: 'center', maxWidth: 500 }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            style={{
              padding: '8px 24px', borderRadius: 6, border: 'none',
              background: '#4a6cf7', color: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            {isZh ? '重新加载' : 'Reload app'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
