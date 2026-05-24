import { useRef, useEffect, useState, useCallback } from 'react';
interface IframeMirrorProps {
    src: string;
    id: string;
    className?: string;
    title?: string;
    visible?: boolean;
}
/**
 * IframeMirror component that prevents iframe reloading on reparenting.
 * It keeps the actual iframe in a persistent, hidden container and displays
 * it by repositioning when visible. This ensures the iframe never unmounts.
 */

export default function IframeMirror({
    src,
    id,
    className = '',
    title = '',
    visible = true
}: IframeMirrorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeContainerIdRef = useRef<string>(`iframe-persistent-${id}`);
    const [isLoaded, setIsLoaded] = useState(false);
    const positionUpdateRef = useRef<number | null>(null);
    // Get or create the persistent iframe container
    const getOrCreatePersistentContainer = useCallback(() => {
        const containerId = iframeContainerIdRef.current;
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = containerId;
            container.style.cssText = `
        position: fixed;
        border: none;
        overflow: hidden;
        z-index: 1;
        background: transparent;
      `;
            document.body.appendChild(container);
            // Create the iframe
            const iframe = document.createElement('iframe');
            iframe.src = src;
            iframe.title = title;
            iframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
        display: block;
      `;
            iframe.onload = () => {
                setIsLoaded(true);
            };
            iframe.onerror = () => {
                console.error('Failed to load iframe:', src);
            };
            container.appendChild(iframe);
        }
        return container;
    }, [id, src, title]);
    // Update iframe position and visibility
    const updateIframePosition = useCallback(() => {
        if (!containerRef.current) return;
        const persistentContainer = getOrCreatePersistentContainer();
        const rect = containerRef.current.getBoundingClientRect();
        if (visible && rect.width > 0 && rect.height > 0) {
            // Position the iframe container to match our visible container
            persistentContainer.style.left = `${rect.left + window.scrollX}px`;
            persistentContainer.style.top = `${rect.top + window.scrollY}px`;
            persistentContainer.style.width = `${rect.width}px`;
            persistentContainer.style.height = `${rect.height}px`;
            persistentContainer.style.pointerEvents = 'auto';
            persistentContainer.style.opacity = '1';
        } else {
            // Hide the iframe when not visible
            persistentContainer.style.left = '-10000px';
            persistentContainer.style.top = '-10000px';
            persistentContainer.style.pointerEvents = 'none';
            persistentContainer.style.opacity = '0';
        }
    }, [visible, getOrCreatePersistentContainer]);
    // Set up continuous position updates
    useEffect(() => {
        const updateLoop = () => {
            updateIframePosition();
            positionUpdateRef.current = requestAnimationFrame(updateLoop);
        };
        updateLoop();
        return () => {
            if (positionUpdateRef.current) {
                cancelAnimationFrame(positionUpdateRef.current);
            }
        };
    }, [updateIframePosition]);
    // Handle window events
    useEffect(() => {
        const handleEvent = () => updateIframePosition();
        window.addEventListener('resize', handleEvent);
        window.addEventListener('scroll', handleEvent, true);
        return () => {
            window.removeEventListener('resize', handleEvent);
            window.removeEventListener('scroll', handleEvent, true);
        };
    }, [updateIframePosition]);
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // When component unmounts, hide the iframe but don't destroy it
            const persistentContainer = document.getElementById(iframeContainerIdRef.current);
            if (persistentContainer) {
                persistentContainer.style.left = '-10000px';
                persistentContainer.style.top = '-10000px';
                persistentContainer.style.pointerEvents = 'none';
            }
        };
    }, []);
    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full ${className}`}
            style={{ background: 'transparent' }}
        >
            {!isLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-card">
                    <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        <span className="text-sm text-muted-foreground">Loading iframe...</span>
                    </div>
                </div>
            )}
        </div>
    );
}
/**
 * Hook to cleanup all persistent iframe containers when needed
 */

export function useCleanupPersistentIframes() {
    return useCallback(() => {
        const containers = document.querySelectorAll('[id^="iframe-persistent-"]');
        containers.forEach(container => container.remove());
    }, []);
}
/**
 * Cleanup a specific persistent iframe container by ID
 */

export function cleanupPersistentIframe(id: string) {
    const container = document.getElementById(`iframe-persistent-${id}`);
    if (container) {
        container.remove();
    }
}
