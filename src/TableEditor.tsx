import type { AppInfo, MessageState } from "openchad-react"
import { useEffect, useState } from "react"

export default function TableEditor({ useTabDatabase }: AppInfo) {
  // 1. Wrap the initial values in a dictionary with a "default" row ID
  const [colsDb, setColsDb] = useTabDatabase("cols", { initialValue: { currentCols: ["name", "age", "", ""] } })
  const [rowsDb, setRowsDb] = useTabDatabase("rows", { initialValue: { currentRows: [["Alice", "30", "", ""], ["", "", "", ""]] } })
  const [copied, setCopied] = useState(false)

  // 2. Unwrap the arrays for rendering
  const cols = colsDb?.currentCols || ["name", "age", "question", "answer"]
  const rows = rowsDb?.currentRows || [["Alice", "30", "", ""], ["", "", "", ""]]

  // 3. Wrap the arrays back into a dictionary when saving
  const setCols = (n: string[]) => setColsDb({ currentCols: n })
  const setRows = (n: string[][]) => setRowsDb({ currentRows: n })

  const toCSV = () => [cols, ...rows].map(r => r.join(",")).join("\n")
  const updateCol = (ci: number, v: string) => { const n = [...cols]; n[ci] = v; setCols(n) }
  const updateCell = (ri: number, ci: number, v: string) => { const n = rows.map(r => [...r]); n[ri][ci] = v; setRows(n) }
  const addRow = () => setRows([...rows, Array(cols.length).fill("")])
  const addCol = () => { setCols([...cols, `col${cols.length + 1}`]); setRows(rows.map(r => [...r, ""])) }
  const deleteRow = (ri: number) => setRows(rows.filter((_, i) => i !== ri))
  const deleteCol = (ci: number) => { setCols(cols.filter((_, i) => i !== ci)); setRows(rows.map(r => r.filter((_, i) => i !== ci))) }
  const handleCopy = () => { navigator.clipboard.writeText(toCSV()); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  const [_, setMessageState, { ready }] = useTabDatabase<MessageState>("message_state", {
    initialValue: {
      title: null,
      activeId: "",
      errorMsg: "",
      initialized: false,
      isStreaming: false,
      context: "",
    },
  });

  useEffect(() => {
    if (ready) {
      setMessageState((prev) => ({
        ...prev,
        initialized: true,
        context: `current table:\`\`\`csv\n${toCSV()}\n\`\`\`\n---\n## Use \`table_editor\` tool \nWhen your task is done please write a readable summary about what you've done \n---\n`,
      }));
    }
  }, [colsDb, rowsDb])

  return (
    <div className="w-full h-full relative flex items-center justify-center">
      <div className="p-4 flex flex-col gap-4 border-accent/5 border rounded-lg min-h-[500px]">
        <div className="flex gap-2">
          <button onClick={addRow} className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted">+ row</button>
          <button onClick={addCol} className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted">+ col</button>
          <button onClick={handleCopy} className="ml-auto px-3 py-1.5 text-sm border border-border rounded hover:bg-muted">{copied ? "copied!" : "copy CSV"}</button>
        </div>
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-border bg-muted w-8" />
              {cols.map((c, ci) => (
                <th key={ci} className="border border-border bg-muted relative p-0 min-w-[80px]">
                  <input value={c} onChange={e => updateCol(ci, e.target.value)} className="w-full bg-transparent px-2 py-1 font-medium outline-none" />
                  <button onClick={() => deleteCol(ci)} className="text-muted-foreground hover:text-destructive px-1 text-xs absolute right-0">×</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-muted/40">
                <td className="border border-border text-center text-xs text-muted-foreground">{ri + 1}</td>
                {cols.map((_, ci) => (
                  <td key={ci} className="border border-border p-0">
                    <input value={row[ci] || ""} onChange={e => updateCell(ri, ci, e.target.value)} className="w-full bg-transparent px-2 py-1 font-mono outline-none" />
                  </td>
                ))}
                <td className="px-1"><button onClick={() => deleteRow(ri)} className="text-muted-foreground hover:text-destructive">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}