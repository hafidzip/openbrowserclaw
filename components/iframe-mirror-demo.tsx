import { useState } from 'react';
import IframeMirror from './iframe-mirror';
import { Button } from './ui/button';
/**
 * Demo component to test iframe mirroring functionality.
 * This demonstrates that iframes don't reload when moved between different layouts.
 */

export default function IframeMirrorDemo() {
    const [layout, setLayout] = useState<'single' | 'dual' | 'triple'>('single');
    const [count, setCount] = useState(0);
    const renderSingleLayout = () => (
        <div className="w-full h-full p-4">
            <IframeMirror
                id="demo-iframe-1"
                src="http://localhost:3001"
                title="Demo Iframe"
                className="border border-border rounded-lg"
            />
        </div>
    );
    const renderDualLayout = () => (
        <div className="w-full h-full p-4 flex gap-4">
            <div className="flex-1">
                <IframeMirror
                    id="demo-iframe-1"
                    src="http://localhost:3001"
                    title="Demo Iframe 1"
                    className="border border-border rounded-lg"
                />
            </div>
            <div className="flex-1">
                <IframeMirror
                    id="demo-iframe-2"
                    src="http://localhost:3001"
                    title="Demo Iframe 2"
                    className="border border-border rounded-lg"
                />
            </div>
        </div>
    );
    const renderTripleLayout = () => (
        <div className="w-full h-full p-4 flex flex-col gap-4">
            <div className="flex-1 flex gap-4">
                <div className="flex-1">
                    <IframeMirror
                        id="demo-iframe-1"
                        src="http://localhost:3001"
                        title="Demo Iframe 1"
                        className="border border-border rounded-lg"
                    />
                </div>
                <div className="flex-1">
                    <IframeMirror
                        id="demo-iframe-2"
                        src="http://localhost:3001"
                        title="Demo Iframe 2"
                        className="border border-border rounded-lg"
                    />
                </div>
            </div>
            <div className="flex-1">
                <IframeMirror
                    id="demo-iframe-3"
                    src="http://localhost:3001"
                    title="Demo Iframe 3"
                    className="border border-border rounded-lg"
                />
            </div>
        </div>
    );
    return (
        <div className="w-full h-screen flex flex-col bg-background">
            <div className="h-16 border-b border-border flex items-center justify-between px-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-semibold">Iframe Mirror Demo</h1>
                    <div className="flex gap-2">
                        <Button
                            variant={layout === 'single' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setLayout('single')}
                        >
                            Single
                        </Button>
                        <Button
                            variant={layout === 'dual' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setLayout('dual')}
                        >
                            Dual
                        </Button>
                        <Button
                            variant={layout === 'triple' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setLayout('triple')}
                        >
                            Triple
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-sm text-muted-foreground">
                        Layout changes: <span className="font-mono font-bold">{count}</span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const layouts: Array<'single' | 'dual' | 'triple'> = ['single', 'dual', 'triple'];
                            const currentIndex = layouts.indexOf(layout);
                            const nextIndex = (currentIndex + 1) % layouts.length;
                            setLayout(layouts[nextIndex]);
                            setCount(c => c + 1);
                        }}
                    >
                        Cycle Layout
                    </Button>
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                {layout === 'single' && renderSingleLayout()}
                {layout === 'dual' && renderDualLayout()}
                {layout === 'triple' && renderTripleLayout()}
            </div>
            <div className="h-12 border-t border-border flex items-center px-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span>Iframes are persistent and won't reload when switching layouts</span>
                </div>
            </div>
        </div>
    );
}
