/**
 * Debugging utilities for iframe mirroring system
 */

export interface IframeDebugInfo {
    containerId: string;
    exists: boolean;
    position: {
        left: string;
        top: string;
        width: string;
        height: string;
    };
    visibility: {
        opacity: string;
        pointerEvents: string;
        zIndex: string;
    };
    hasIframe: boolean;
    iframeSrc?: string;
}
/**
 * Get debug information about a specific iframe mirror
 */

export function getIframeMirrorDebugInfo(iframeId: string): IframeDebugInfo | null {
    const containerId = `iframe-persistent-${iframeId}`;
    const container = document.getElementById(containerId);
    if (!container) {
        return {
            containerId,
            exists: false,
            position: { left: 'N/A', top: 'N/A', width: 'N/A', height: 'N/A' },
            visibility: { opacity: 'N/A', pointerEvents: 'N/A', zIndex: 'N/A' },
            hasIframe: false,
        };
    }
    const iframe = container.querySelector('iframe');
    return {
        containerId,
        exists: true,
        position: {
            left: container.style.left,
            top: container.style.top,
            width: container.style.width,
            height: container.style.height,
        },
        visibility: {
            opacity: container.style.opacity,
            pointerEvents: container.style.pointerEvents,
            zIndex: container.style.zIndex,
        },
        hasIframe: !!iframe,
        iframeSrc: iframe?.src,
    };
}
/**
 * Get debug information about all iframe mirrors
 */

export function getAllIframeMirrorsDebugInfo(): IframeDebugInfo[] {
    const containers = document.querySelectorAll('[id^="iframe-persistent-"]');
    const infos: IframeDebugInfo[] = [];
    containers.forEach(container => {
        const id = container.id.replace('iframe-persistent-', '');
        const info = getIframeMirrorDebugInfo(id);
        if (info) {
            infos.push(info);
        }
    });
    return infos;
}
/**
 * Log all iframe mirrors to console with formatted output
 */

export function logIframeMirrors(): void {
    const infos = getAllIframeMirrorsDebugInfo();
    console.group('🔍 Iframe Mirror Debug Info');
    console.log(`Total persistent iframes: ${infos.length}`);
    if (infos.length === 0) {
        console.log('No iframe mirrors found');
    } else {
        infos.forEach((info, index) => {
            console.group(`Iframe ${index + 1}: ${info.containerId}`);
            console.table({
                'Exists': info.exists,
                'Has Iframe': info.hasIframe,
                'Source': info.iframeSrc || 'N/A',
                'Left': info.position.left,
                'Top': info.position.top,
                'Width': info.position.width,
                'Height': info.position.height,
                'Opacity': info.visibility.opacity,
                'Pointer Events': info.visibility.pointerEvents,
                'Z-Index': info.visibility.zIndex,
            });
            console.groupEnd();
        });
    }
    console.groupEnd();
}
/**
 * Highlight all iframe mirror containers for debugging
 */

export function highlightIframeMirrors(duration: number = 2000): void {
    const containers = document.querySelectorAll('[id^="iframe-persistent-"]');
    containers.forEach(container => {
        const element = container as HTMLElement;
        const originalBorder = element.style.border;
        const originalBoxShadow = element.style.boxShadow;
        element.style.border = '3px solid #16a34a';
        element.style.boxShadow = '0 0 20px #16a34a';
        setTimeout(() => {
            element.style.border = originalBorder;
            element.style.boxShadow = originalBoxShadow;
        }, duration);
    });
    console.log(`✨ Highlighted ${containers.length} iframe mirrors for ${duration}ms`);
}
/**
 * Force cleanup of all iframe mirrors (useful for development)
 */

export function forceCleanupIframeMirrors(): void {
    const containers = document.querySelectorAll('[id^="iframe-persistent-"]');
    const count = containers.length;
    containers.forEach(container => container.remove());
    console.log(`🧹 Cleaned up ${count} iframe mirror containers`);
}
/**
 * Watch for iframe mirror position changes (debugging)
 */

export function watchIframeMirrorPosition(iframeId: string, callback: (info: IframeDebugInfo) => void): () => void {
    let lastInfo: IframeDebugInfo | null = null;
    const interval = setInterval(() => {
        const info = getIframeMirrorDebugInfo(iframeId);
        if (!info) {
            return;
        }
        // Check if position changed
        if (!lastInfo ||
            lastInfo.position.left !== info.position.left ||
            lastInfo.position.top !== info.position.top ||
            lastInfo.position.width !== info.position.width ||
            lastInfo.position.height !== info.position.height) {
            callback(info);
            lastInfo = info;
        }
    }, 100);
    return () => clearInterval(interval);
}
/**
 * Add debugging commands to window object for console access
 */

export function enableIframeMirrorDebugMode(): void {
    if (typeof window !== 'undefined') {
        (window as any).iframeMirrorDebug = {
            getInfo: getIframeMirrorDebugInfo,
            getAllInfo: getAllIframeMirrorsDebugInfo,
            log: logIframeMirrors,
            highlight: highlightIframeMirrors,
            cleanup: forceCleanupIframeMirrors,
            watch: watchIframeMirrorPosition,
        };
        console.log('✅ Iframe Mirror Debug Mode Enabled');
        console.log('Available commands:');
        console.log('  window.iframeMirrorDebug.log()        - Log all iframes');
        console.log('  window.iframeMirrorDebug.highlight()  - Highlight all iframes');
        console.log('  window.iframeMirrorDebug.cleanup()    - Remove all iframes');
        console.log('  window.iframeMirrorDebug.getInfo(id)  - Get info for specific iframe');
        console.log('  window.iframeMirrorDebug.getAllInfo() - Get info for all iframes');
    }
}
// Example usage in development:
// import { enableIframeMirrorDebugMode } from './utils/iframe-mirror-debug';
// if (import.meta.env.DEV) {
//   enableIframeMirrorDebugMode();
// }
