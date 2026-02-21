import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * ErrorBoundary global — atrapa crashes de JS en cualquier página
 * y muestra un botón para reintentar sin pantalla blanca.
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("ErrorBoundary caught:", error, info.componentStack);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-navy text-ivory px-6 text-center gap-6">
                    <div className="text-5xl">⚠️</div>
                    <h1 className="text-xl font-bold">Algo salió mal</h1>
                    <p className="text-ivory/60 text-sm max-w-xs">
                        Ocurrió un error inesperado. Puedes intentar recargar esta sección.
                    </p>
                    <button
                        onClick={this.handleRetry}
                        className="px-6 py-2 rounded-lg bg-gold text-navy font-semibold text-sm hover:bg-gold/90 transition-colors"
                    >
                        Reintentar
                    </button>
                    {this.state.error && (
                        <details className="text-xs text-ivory/40 max-w-sm">
                            <summary className="cursor-pointer">Detalles técnicos</summary>
                            <pre className="mt-2 whitespace-pre-wrap break-all">
                                {this.state.error.message}
                            </pre>
                        </details>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
