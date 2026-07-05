import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useAnimationFrame } from 'motion/react';
import { useAvailableAgents, usePython, usePythonEvent, useSnapshot, useGlobal, generateIdFromString, type IAgent } from './index';
import { useDatabaseImpl } from './components/useDatabase';
import { useWorkspaceState } from './utils/state';
import { plainToBlocks } from './components/composer';

//  Character Registry 

interface CharacterDefinition {
    id: string;
    name: string;
    path: string;
    walkFramesCount: number;
    attackFramesCount: number;
    scale: number;
    speedMultiplier: number;
}

const CHARACTER_REGISTRY: Record<string, CharacterDefinition> = {
    villager: {
        id: 'villager',
        name: 'Villager',
        path: '/villager',
        walkFramesCount: 8,
        attackFramesCount: 8,
        scale: 1.0,
        speedMultiplier: 1.0,
    }
};

//  Sprite Image Cache 

type SpriteSet = { walk: HTMLImageElement[]; attack: HTMLImageElement[] };

const imageCache: Record<string, { promise: Promise<SpriteSet> }> = {};

function loadFrames(basePath: string, action: string, count: number): Promise<HTMLImageElement[]> {
    return Promise.all(
        Array.from({ length: count }, (_, i) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.src = `${basePath}/${action}/${i + 1}.png`;
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Failed: ${img.src}`));
            })
        )
    );
}

function getOrLoadCharacter(type: string, config: CharacterDefinition): Promise<SpriteSet> {
    if (!imageCache[type]) {
        // Create cache entry first to prevent concurrent duplicate loads
        imageCache[type] = {
            promise: Promise.all([
                loadFrames(config.path, 'walk', config.walkFramesCount),
                loadFrames(config.path, 'attack', config.attackFramesCount),
            ]).then(([walk, attack]) => ({ walk, attack })),
        };
    }
    return imageCache[type].promise;
}

//  Enemy Registry 

interface EnemyDefinition {
    id: string;
    name: string;
    imagePath: string;
    width: number;
    height: number;
}

const ENEMY_REGISTRY: EnemyDefinition[] = [
    { id: 'slime', name: 'Slime', imagePath: '/enemies/slime.png', width: 24, height: 24 },
];

//  Domain Types 

interface QueuedEnemy {
    id: string;
    direction: 'left' | 'right';
    hp: number;
    imagePath: string;
    width: number;
    height: number;
}

// DummyEnemy is pure render state — HP lives in QueuedEnemy (queue is source of truth)
interface DummyEnemy {
    id: string;
    direction: 'left' | 'right';
    isHit: boolean;  // true = death / spin-away animation
    shake: boolean;  // true = non-lethal damage wobble
    imagePath: string;
    width: number;
    height: number;
}

interface DamageNumber {
    id: string;
    value: number;
    x: number;
    y: number;
    isCrit: boolean;
}

//  Sub-Components 

function DummyEnemyComponent({ enemy }: { enemy: DummyEnemy }) {
    // Enemy on the right looks left toward the player; flip accordingly
    const flipScale = enemy.direction === 'right' ? -1 : 1;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 10 }}
            animate={enemy.isHit ? {
                opacity: [1, 1, 0],
                scale: [1, 1.1, 0.8],
                x: enemy.direction === 'right' ? [0, 15, 20] : [0, -15, -20],
                y: [0, -12, 15],
                rotate: enemy.direction === 'right' ? [0, 45, 90] : [0, -45, -90],
            } : enemy.shake ? {
                x: [0, -4, 4, -4, 4, 0],
            } : {
                opacity: 1, scale: 1, y: 0,
            }}
            transition={enemy.isHit
                ? { duration: 0.8, ease: 'easeOut' }
                : enemy.shake
                    ? { duration: 0.3 }
                    : undefined}
            style={{
                position: 'absolute',
                left: enemy.direction === 'right' ? 25 : -5,
                bottom: 4,
                width: enemy.width,
                height: enemy.height,
                zIndex: 10,
                pointerEvents: 'none',
            }}
        >
            <div className="relative w-full h-full">
                <motion.img
                    src={enemy.imagePath}
                    alt="Enemy"
                    animate={(enemy.shake || enemy.isHit) ? {
                        filter: [
                            'brightness(1) invert(0)',
                            'brightness(0) invert(1)',
                            'brightness(1) invert(0)',
                            'brightness(0) invert(1)',
                            'brightness(1) invert(0)',
                        ],
                    } : { filter: 'brightness(1) invert(0)' }}
                    transition={{ duration: 0.35, ease: 'easeInOut' }}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        imageRendering: 'pixelated',
                        transform: `scaleX(${flipScale})`,
                    }}
                />
                {enemy.isHit && (
                    <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0.8, 1.5, 0], opacity: [0, 1, 0] }}
                        transition={{ duration: 0.3 }}
                        className="absolute inset-0 flex items-center justify-center text-red-500 font-extrabold text-xs select-none"
                    >
                        ⚡
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
}

function DamageNumberComponent({ dmg }: { dmg: DamageNumber }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: dmg.y, scale: 0.5 }}
            animate={{
                opacity: [0, 1, 1, 0],
                y: [dmg.y, dmg.y - 28, dmg.y - 42],
                scale: dmg.isCrit ? [1.2, 1.5, 1.5, 1.0] : [1.0, 1.1, 1.1, 0.9],
            }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
                position: 'absolute',
                top: 6,
                left: dmg.x,
                color: dmg.isCrit ? '#facc15' : '#ef4444',
                fontWeight: 'bold',
                fontSize: dmg.isCrit ? '12px' : '10px',
                textShadow: '0px 1px 3px rgba(0,0,0,0.8)',
                zIndex: 50,
                pointerEvents: 'none',
                fontFamily: 'monospace',
            }}
        >
            {dmg.value}
            {dmg.isCrit && <span className="text-[8px] ml-0.5 font-sans italic tracking-wider">CRIT!</span>}
        </motion.div>
    );
}

//  PatrollingAgent 

interface PatrollingAgentProps { agent: IAgent; containerWidth: number; }

const PatrollingAgent = memo(function PatrollingAgent({ agent, containerWidth }: PatrollingAgentProps) {
    const [, setChatId] = useGlobal<string | null>('chatId', { initialValue: null });

    // Fetch streaming state from SQLite database for this task
    // Must match the key used in MessageContainer / Tasks.tsx:
    // generateIdFromString(agent.id + "/" + "message_state"), then useDatabaseImpl (no extra hash).
    const tbName = generateIdFromString((agent.id || '') + "/" + "message_state");
    const [messageState] = useDatabaseImpl<any>(tbName, {
        initialValue: {
            title: null,
            activeId: "",
            errorMsg: "",
            initialized: false,
            isStreaming: false,
            context: "",
        }
    });
    const isStreaming = !!messageState?.isStreaming;

    const initialX = useRef(Math.random() * Math.max(100, containerWidth - 80) + 10);
    const x = useMotionValue(initialX.current);
    const xRef = useRef(initialX.current);

    const [currentState, setCurrentState] = useState<'walk' | 'attack'>('walk');
    const [direction, setDirection] = useState<'left' | 'right'>(Math.random() > 0.5 ? 'right' : 'left');
    const [targetX, setTargetX] = useState(initialX.current);
    const [speed, setSpeed] = useState(25 + Math.random() * 25);
    const [isHovered, setIsHovered] = useState(false);
    const [userDismissed, setUserDismissed] = useState(false);
    const [spawnTrigger, setSpawnTrigger] = useState(0); // bumped to force-respawn queue during attack
    const [showBubble, setShowBubble] = useState(false);
    const [prefixIndex, setPrefixIndex] = useState(0);
    const [dummyEnemies, setDummyEnemies] = useState<DummyEnemy[]>([]);
    const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null); // cached context
    const bubblePrefixTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [images, setImages] = useState<SpriteSet | null>(null);

    //  State refs (sync'd each render so the animation loop can read them without stale closures)
    const currentStateRef = useRef(currentState);   currentStateRef.current = currentState;
    const directionRef    = useRef(direction);       directionRef.current    = direction;
    const targetXRef      = useRef(targetX);         targetXRef.current      = targetX;
    const speedRef        = useRef(speed);           speedRef.current        = speed;

    //  Animation / Combat refs (mutated directly inside the frame loop — never trigger re-renders)
    const frameIndexRef    = useRef(0);
    const lastFrameTimeRef = useRef(0);
    // facingRef is the GROUND TRUTH for sprite direction.
    // Always updated synchronously inside useAnimationFrame — never lags a React render.
    const facingRef        = useRef<'left' | 'right'>('right');
    const enemyQueueRef    = useRef<QueuedEnemy[]>([]);
    const hitProcessedRef  = useRef(false);

    const ATTACK_PREFIXES = ['Working on', 'Processing', 'Executing', 'Handling', 'Running'];

    const truncatedQuery = useMemo(() => {
        const q = (agent as any).query || 'task';
        return q.length > 32 ? q.slice(0, 32) + '...' : q;
    }, [(agent as any).query]);

    //  Character config
    const characterType = useMemo(() => {
        const taskAgent = (agent as any).agent?.toLowerCase() || '';
        if (CHARACTER_REGISTRY[taskAgent]) return taskAgent;
        const nameLower = agent.name?.toLowerCase() || '';
        if (CHARACTER_REGISTRY[nameLower]) return nameLower;
        for (const key of Object.keys(CHARACTER_REGISTRY)) {
            if (nameLower.includes(key) || taskAgent.includes(key)) return key;
        }
        return 'villager';
    }, [agent]);

    const characterConfig = useMemo(
        () => CHARACTER_REGISTRY[characterType] ?? CHARACTER_REGISTRY.villager,
        [characterType]
    );

    //  Sprite loading
    useEffect(() => {
        let active = true;
        getOrLoadCharacter(characterType, characterConfig).then(loaded => {
            if (active) setImages(loaded);
        });
        return () => { active = false; };
    }, [characterType, characterConfig]);

    //  Walk helpers
    const startNewWalk = useCallback(() => {
        if (containerWidth <= 100) return;
        const margin = 20;
        const newTarget = margin + Math.random() * (containerWidth - margin * 2 - 44);
        const newDir = newTarget > xRef.current ? 'right' : 'left';
        facingRef.current = newDir; // sync immediately so canvas is correct this frame
        setTargetX(newTarget);
        setSpeed((25 + Math.random() * 25) * characterConfig.speedMultiplier);
        setDirection(newDir);
    }, [containerWidth, characterConfig]);

    // Sync character state with database streaming status
    // Show/hide bubble and cycle prefixes when entering/leaving attack state
    useEffect(() => {
        setCurrentState(isStreaming ? 'attack' : 'walk');
        if (isStreaming) {
            setPrefixIndex(0);
            setShowBubble(true);
            bubblePrefixTimerRef.current = setInterval(() => {
                setPrefixIndex(p => (p + 1) % ATTACK_PREFIXES.length);
            }, 2200);
        } else {
            setShowBubble(false);
            if (bubblePrefixTimerRef.current) {
                clearInterval(bubblePrefixTimerRef.current);
                bubblePrefixTimerRef.current = null;
            }
            startNewWalk();
        }
        return () => {
            if (bubblePrefixTimerRef.current) {
                clearInterval(bubblePrefixTimerRef.current);
                bubblePrefixTimerRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStreaming, startNewWalk]);

    //  Ensure walk target is set on initial mount
    useEffect(() => {
        if (currentState === 'walk' && xRef.current === targetX) startNewWalk();
    }, [currentState, startNewWalk, targetX]);

    //  Enemy factory
    const makeEnemy = useCallback((): QueuedEnemy => {
        const def = ENEMY_REGISTRY[Math.floor(Math.random() * ENEMY_REGISTRY.length)];
        return {
            id: Math.random().toString(36).substring(2, 9),
            direction: Math.random() > 0.5 ? 'right' : 'left',
            hp: 3,
            imagePath: def.imagePath,
            width: def.width,
            height: def.height,
        };
    }, []);

    //  Visually add a dummy to the DOM (no HP — queue owns that)
    const spawnVisualEnemy = useCallback((enemy: QueuedEnemy) => {
        setDummyEnemies(prev => [...prev, {
            id: enemy.id,
            direction: enemy.direction,
            isHit: false,
            shake: false,
            imagePath: enemy.imagePath,
            width: enemy.width,
            height: enemy.height,
        }]);
    }, []);

    //  Hit effects (no enemyDir param — facingRef is authoritative)
    const triggerHit = useCallback((enemyId: string, isLastHit: boolean) => {
        if (isLastHit) {
            setDummyEnemies(prev => prev.map(e => e.id === enemyId ? { ...e, isHit: true } : e));
            setTimeout(() => setDummyEnemies(prev => prev.filter(e => e.id !== enemyId)), 1000);
            return; // No damage number on last hit
        }

        // Non-lethal: shake + damage number
        setDummyEnemies(prev => prev.map(e => e.id === enemyId ? { ...e, shake: true } : e));
        setTimeout(
            () => setDummyEnemies(prev => prev.map(e => e.id === enemyId ? { ...e, shake: false } : e)),
            300
        );

        const isCrit = Math.random() > 0.6;
        const value  = isCrit ? Math.floor(120 + Math.random() * 80) : Math.floor(40 + Math.random() * 50);
        const dmgId  = Math.random().toString(36).substring(2, 9);
        const dmgX   = facingRef.current === 'right' ? 42 : -14;

        setDamageNumbers(prev => [...prev, {
            id: dmgId, value, isCrit,
            x: dmgX + (Math.random() * 10 - 5),
            y: Math.random() * 4 - 2,
        }]);
        setTimeout(() => setDamageNumbers(prev => prev.filter(d => d.id !== dmgId)), 800);

    }, []);

    //  Seed/clear enemy queue on state transition
    useEffect(() => {
        if (currentState !== 'attack') {
            enemyQueueRef.current = [];
            hitProcessedRef.current = false;
            setDummyEnemies([]);
            setDamageNumbers([]);
            return;
        }

        // Queue invariant: [current(visible), lookahead(invisible)]
        const first  = makeEnemy();
        const second = makeEnemy();
        enemyQueueRef.current = [first, second];

        facingRef.current = first.direction;
        setDirection(first.direction);
        spawnVisualEnemy(first); // only first is visible; second is the invisible lookahead

        // Always start attack animation from frame 0 to prevent stale frame-3 instant-hits
        frameIndexRef.current = 0;
        hitProcessedRef.current = false;
    }, [currentState, makeEnemy, spawnVisualEnemy, spawnTrigger]);

    //  Main animation frame loop
    useAnimationFrame((time, delta) => {
        if (!images) return;

        // 1. Walk movement + facing sync
        if (currentStateRef.current === 'walk') {
            // Always keep facingRef in sync with direction state during walk.
            // Handles the attack→walk transition where facingRef still points to the last attack direction.
            facingRef.current = directionRef.current;

            const dirSign = directionRef.current === 'right' ? 1 : -1;
            const nextX = xRef.current + (speedRef.current * delta) / 1000 * dirSign;
            const reached = dirSign === 1 ? nextX >= targetXRef.current : nextX <= targetXRef.current;

            if (reached) {
                const margin = 20;
                const newTarget = margin + Math.random() * (containerWidth - margin * 2 - 44);
                const newDir = newTarget > xRef.current ? 'right' : 'left';
                facingRef.current = newDir;
                setTargetX(newTarget);
                setDirection(newDir);
            } else {
                xRef.current = nextX;
                x.set(nextX);
            }
        }

        // 2. Advance animation frame (always ticks — never pauses)
        const frames    = currentStateRef.current === 'attack' ? images.attack : images.walk;
        const msPerFrame = currentStateRef.current === 'attack' ? 70 : 100;

        if (time - lastFrameTimeRef.current >= msPerFrame) {
            lastFrameTimeRef.current = time;
            frameIndexRef.current = (frameIndexRef.current + 1) % frames.length;

            // On loop-back to 0 during attack: reset hit gate + snap facing to next target
            if (frameIndexRef.current === 0 && currentStateRef.current === 'attack') {
                hitProcessedRef.current = false;
                const head = enemyQueueRef.current[0];
                if (head) {
                    facingRef.current = head.direction;
                    setDirection(head.direction); // keep React state in sync for dummy positioning
                }
            }
        }

        // 3. Queue-based hit at frame 3
        if (
            currentStateRef.current === 'attack' &&
            frameIndexRef.current === 3 &&
            !hitProcessedRef.current &&
            enemyQueueRef.current.length > 0
        ) {
            hitProcessedRef.current = true;
            const current = enemyQueueRef.current[0];
            current.hp -= 1;
            const isLastHit = current.hp <= 0;

            triggerHit(current.id, isLastHit);

            if (isLastHit) {
                // Dequeue the defeated enemy
                enemyQueueRef.current = enemyQueueRef.current.slice(1);

                // Make the invisible lookahead visible now (it's now the head)
                const head = enemyQueueRef.current[0];
                if (head) spawnVisualEnemy(head);

                // Append a new invisible lookahead
                enemyQueueRef.current.push(makeEnemy());
            }
        }

        // 4. Render to canvas — flip is applied here via ctx.scale (synchronous, no CSS lag)
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Cache the 2D context to avoid repeated getContext calls
        if (!ctxRef.current) ctxRef.current = canvas.getContext('2d');
        const ctx = ctxRef.current;
        if (!ctx) return;

        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const frameImg = frames[frameIndexRef.current];
        if (frameImg) {
            const dw = w * characterConfig.scale;
            const dh = h * characterConfig.scale;
            ctx.save();
            if (facingRef.current === 'left') {
                ctx.translate(w, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(frameImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
            ctx.restore();
        }
    });

    //  Container resize guard
    useEffect(() => {
        const maxX = Math.max(10, containerWidth - 50);
        if (xRef.current > maxX) {
            xRef.current = maxX;
            x.set(maxX);
            if (currentState === 'walk') startNewWalk();
        }
    }, [containerWidth, currentState, startNewWalk, x]);

    //  Cleanup
    useEffect(() => () => {
        if (bubblePrefixTimerRef.current) clearInterval(bubblePrefixTimerRef.current);
    }, []);

    //  Re-show bubble on hover while streaming (after user dismissed it with X)
    //  Guard: don't re-show immediately if user just clicked X (userDismissed clears on real onMouseLeave)
    useEffect(() => {
        if (isHovered && isStreaming && !userDismissed) {
            setShowBubble(true);
        }
    }, [isHovered, isStreaming, userDismissed]);

    //  Click handler — just navigate, no bubble
    const handleClick = useCallback(() => {
        if (currentState === 'attack') {
            setSpawnTrigger(p => p + 1); // force-respawn the enemy queue
        }
        if (agent.id) {
            setChatId(agent.id);
        }
    }, [currentState, agent.id, setChatId]);

    return (
        <div className="absolute bottom-9 h-11" style={{ pointerEvents: 'auto' }}>
            <motion.div
                style={{ x, position: 'relative', width: 44, height: 44 }}
                animate={isHovered ? { y: -2, scale: 1.05 } : { y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => { setIsHovered(false); setUserDismissed(false); }}
                onClick={handleClick}
                className="cursor-pointer select-none"
            >
                {/* Speech Bubble — visible only during attack/streaming */}
                {showBubble && (
                    <div
                        className="absolute left-5 bottom-[45px] bg-zinc-950/95 dark:bg-black/95 text-zinc-100 border border-zinc-800/80 px-3 py-1.5 rounded-xl shadow-2xl text-[10px] font-medium backdrop-blur-md whitespace-nowrap z-50 flex items-center gap-1.5 max-w-[160px]"
                        style={{ transform: 'translateX(-50%)' }}
                    >
                        <AnimatePresence mode="wait">
                            <motion.span
                                key={prefixIndex}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.25 }}
                                className="flex items-center gap-1 truncate"
                            >
                                <span className="text-amber-400 shrink-0">{ATTACK_PREFIXES[prefixIndex]}…</span>
                                <span className="truncate opacity-80">{truncatedQuery}</span>
                            </motion.span>
                        </AnimatePresence>
                        {/* Dismiss button — only visible when hovering the sprite and isStreaming */}
                        {isHovered && isStreaming && (
                            <button
                                onClick={e => { e.stopPropagation(); setShowBubble(false); setUserDismissed(true); setIsHovered(false); }}
                                className="shrink-0 ml-0.5 p-0.5 rounded-full text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors cursor-pointer"
                                style={{ lineHeight: 0 }}
                            >
                                <X size={10} strokeWidth={2.5} />
                            </button>
                        )}
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-950 dark:bg-black border-r border-b border-zinc-800 rotate-45" />
                    </div>
                )}

                {/* Name Tag on Hover */}
                {isHovered && (
                    <div
                        className="absolute left-5 bottom-9 bg-zinc-900/90 text-zinc-100 px-2 py-0.5 rounded-md text-[9px] font-semibold border border-zinc-800/70 backdrop-blur-sm shadow-md whitespace-nowrap z-50"
                        style={{ transform: 'translateX(-50%)' }}
                    >
                        {agent.name || 'ChadBot'}
                    </div>
                )}

                {/* Dummy Enemies */}
                <AnimatePresence>
                    {dummyEnemies.map(enemy => (
                        <DummyEnemyComponent key={enemy.id} enemy={enemy} />
                    ))}
                </AnimatePresence>

                {/* Damage Numbers */}
                <AnimatePresence>
                    {damageNumbers.map(dmg => (
                        <DamageNumberComponent key={dmg.id} dmg={dmg} />
                    ))}
                </AnimatePresence>

                {/* Canvas — sprite flip is handled via ctx.scale inside the frame loop */}
                <canvas
                    ref={canvasRef}
                    width={64}
                    height={64}
                    style={{ width: 44, height: 44, imageRendering: 'pixelated', display: 'block' }}
                />
            </motion.div>
        </div>
    );
});

// ─── Custom Hook to fetch Tasks ───────────────────────────────────────────────

function useAvailableTasks() {
    const { pyInvoke } = usePython();
    const [{ workspace }] = useWorkspaceState();
    const { agents } = useAvailableAgents();
    const [tasks, setTasks] = useState<IAgent[]>([]);
    const [isLoading, setLoading] = useState(true);

    const workspaceRef = useRef(workspace);
    workspaceRef.current = workspace;

    const fetchTasks = useCallback(async (cancelledRef?: { current: boolean }) => {
        try {
            const db = workspaceRef.current ?? "global";
            const res: any = await pyInvoke('sqlite', {
                db,
                command: 'query',
                sql: 'SELECT id, metadata FROM tasks ORDER BY rowid DESC',
                params: []
            });
            if (cancelledRef?.current) return;

            const rows: any[] = res?.data ?? (Array.isArray(res) ? res : []);
            if (!Array.isArray(rows)) return;

            const list: IAgent[] = rows.map((row: any) => {
                try {
                    const m = JSON.parse(row.metadata);
                    
                    const agentId = m.agent || 'villager';
                    let agentName = 'ChadBot';
                    
                    if (CHARACTER_REGISTRY[agentId.toLowerCase()]) {
                        agentName = CHARACTER_REGISTRY[agentId.toLowerCase()].name;
                    } else {
                        const foundAgent = agents.find((a: any) => a.id === agentId);
                        if (foundAgent) {
                            agentName = foundAgent.name || 'Unknown Agent';
                        } else {
                            agentName = agentId.split('/').pop()?.split(':').shift() || agentId;
                        }
                    }

                    let queryText = 'Task';
                    if (m.query) {
                        try {
                            const blocks = plainToBlocks(m.query);
                            const textParts = blocks
                                .filter((b: any) => b.type === 'text')
                                .map((b: any) => b.value || '')
                                .join(' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                            queryText = textParts || 'Task';
                        } catch {
                            queryText = m.query;
                        }
                    }

                    return {
                        id: row.id,
                        name: agentName,
                        icon: m.icon || 'AlarmClockCheck',
                        timestamp: m.timestamp || 0,
                        agent: agentId,
                        query: queryText
                    };
                } catch {
                    return {
                        id: row.id,
                        name: 'Task',
                        icon: null,
                        timestamp: 0,
                        agent: 'villager',
                        query: 'Task'
                    };
                }
            });

            if (!cancelledRef || !cancelledRef.current) {
                setTasks(prev => {
                    if (prev.length === list.length && prev.every((item, i) => 
                        item.id === list[i].id && 
                        item.name === list[i].name && 
                        item.icon === list[i].icon &&
                        (item as any).agent === (list[i] as any).agent &&
                        (item as any).query === (list[i] as any).query
                    )) {
                        return prev;
                    }
                    return list;
                });
            }
        } catch (e) {
            if (!cancelledRef || !cancelledRef.current) console.error('Failed to load tasks:', e);
        } finally {
            if (!cancelledRef || !cancelledRef.current) setLoading(false);
        }
    }, [pyInvoke, agents]);

    useEffect(() => {
        const dbName = workspace ?? "global";
        let active = true;

        pyInvoke('db_subscribe', { db: dbName, table: 'tasks' })
            .then(() => {
                if (active) fetchTasks();
            })
            .catch(() => {});

        return () => {
            active = false;
            pyInvoke('db_unsubscribe', { db: dbName, table: 'tasks' }).catch(() => {});
        };
    }, [workspace, fetchTasks, pyInvoke]);

    const dbName = workspace ?? "global";
    usePythonEvent(`db_changed:${dbName}.tasks`, () => {
        fetchTasks();
    });

    usePythonEvent('task_disabled', () => {
        fetchTasks();
    });

    // Fallback polling
    useEffect(() => {
        const timer = setInterval(() => {
            fetchTasks();
        }, 3000);
        return () => clearInterval(timer);
    }, [fetchTasks]);

    return { tasks, isLoading };
}

//  Root Export 

export default function TaskBarAgent() {
    const { tasks } = useAvailableTasks();
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(window.innerWidth);

    useEffect(() => {
        const measure = () => setWidth(containerRef.current?.clientWidth ?? window.innerWidth);
        window.addEventListener('resize', measure);
        setTimeout(measure, 100);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const activeAgents = useMemo(() =>
        tasks?.length ? tasks : [],
        [tasks]
    );

    return (
        <div
            ref={containerRef}
            id="agent-floor"
            className="fixed bottom-0 left-0 w-full h-11 bg-zinc-950/[0.01] dark:bg-black/[0.01] border-t border-zinc-500/[0.05] backdrop-blur-[1px] pointer-events-none z-50 overflow-visible"
        >
            {activeAgents.map(agent => (
                <PatrollingAgent key={agent.id ?? 'default'} agent={agent} containerWidth={width} />
            ))}
        </div>
    );
}
