"use client"
import clsx from "clsx"

export default function Topbar({ Elements, reverse = false }: { Elements?: React.ReactNode[], reverse?: boolean }) {
  return (
    <div className={clsx("relative h-[40px] flex items-start z-10 pointer-events-none select-none", "justify-end")}>
      <div className="w-full  pointer-events-none" style={{ top: '2px' }}>
        <div className={clsx("absolute z-10 -mb-8 origin-top  pointer-events-none", reverse ? "-left-7" : "right-0")} >
          <svg className={clsx("h-9 overflow-visible pointer-events-none", reverse ? "origin-center scale-x-[-1] skew-x-[32.5deg]" : "origin-top-left skew-x-[32.5deg]")} viewBox={"0 0 " + ((Elements?.length || 2) * 45) + " 32"} xmlns="http://www.w3.org/2000/svg">
            <line x1="1" y1="0" x2={((Elements?.length || 2) * 45)} y2="0" strokeWidth="2" strokeLinecap="round" stroke="hsl(var(--bg))" />
            <path
              className='pointer-events-none'
              fill="hsl(var(--bg))"
              stroke="hsl(var(--chat-border))"
              strokeWidth="1"
              strokeLinecap="round"
              d={"M0,0c5.9,0,10.7,4.8,10.7,10.7v10.7c0,5.9,4.8,10.7,10.7,10.7H" + ((Elements?.length || 2) * (reverse ? 40: 45)) + "V0"}
            />
          </svg>
          {/* Floating glass tab with actions (interactive) */}
          {Elements && Elements.length > 0 && <div className={clsx("w-full absolute top-1/2 transform -translate-y-1/2 flex justify-between pointer-events-none", reverse ? "pl-8 pr-7 flex-row-reverse" : "pl-8 pr-3")}>
            {Elements?.map((element, index) => (
              <div className={clsx(
                "pointer-events-none",
              )} key={index}>{element}</div>
            ))}
          </div>}
        </div>
      </div>
    </div>
  )
}
