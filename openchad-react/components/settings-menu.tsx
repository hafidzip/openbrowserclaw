import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Checkbox } from "./ui/checkbox";
import { useMemo } from "react";
import { Button } from "./ui/button";

export default function SettingsMenu() {
    const configText = "{}"
    const config = useMemo(() => {
        try {
            return JSON.parse(configText);
        } catch (e) {
            return { models: {}, available_models: {} };
        }
    }, [configText]);
    const availableModels = useMemo(() => {
        const models = config.available_models || {};
        return Object.values(models).sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
    }, [config]);
    const toggleModel = (_model: any) => {
    };
    return (
        <ScrollArea className="flex-1">
            <div className="flex px-6 pb-3">
                <div className="flex justify-center items-end w-12 text-center px-2">
                    <Checkbox />
                </div>
                <span className="flex-1 text-accent">Model</span>
                <span className="text-right text-accent">Provider</span>
            </div>
            <ScrollArea className="px-6 border-t h-75 border-[hsl(var(--chat-border))]">
                <Table>
                    <TableHeader className="hidden">
                        <TableRow className="hover:bg-transparent border-accent/10">
                            <TableHead className="w-12 text-accent/70 px-2 text-center">
                                {/* Header checkbox could be "Select All" if needed */}
                            </TableHead>
                            <TableHead className="text-accent/70 font-funnel uppercase text-[10px] tracking-wider">Model Name</TableHead>
                            <TableHead className="text-accent/70 font-funnel uppercase text-[10px] tracking-wider">Provider</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {availableModels.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground font-funnel text-sm">
                                    No models available in config.json
                                </TableCell>
                            </TableRow>
                        ) : (
                            availableModels.map((model: any) => (
                                <TableRow
                                    key={model.id}
                                    className="border-accent/5 hover:bg-accent/5 transition-colors cursor-pointer h-11"
                                    onClick={() => toggleModel(model)}
                                >
                                    <TableCell className="w-12 text-center px-2" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex justify-center">
                                            <Checkbox
                                                onCheckedChange={() => toggleModel(model)}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium text-sm">
                                        <div className="flex flex-col">
                                            <span>{model.name}</span>
                                            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={model.id}>
                                                {model.id}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs text-right text-muted-foreground">
                                        {model.provider || "Unknown"}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>
            <div className="w-full flex justify-end py-2">
                <Button>
                    Add Models
                </Button>
            </div>
        </ScrollArea>
    );
}
