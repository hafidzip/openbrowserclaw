import { useEffect } from "react";
import type { EffectCallback } from "react";
import { useSnapshot } from "valtio";
import { KeyState } from "../../utils/state";

export default function useKeyEffect(callback: EffectCallback, keys: string[]) {
    const { keys: KEYS } = useSnapshot(KeyState);
    useEffect(() => {
        // Check if all keys are active
        const active = keys.every(key => KEYS[key]);
        if (active) {
            // Call the callback and return its result (cleanup function)
            return callback();
        }
        // If not active, return undefined (no cleanup needed)
    }, [KEYS, callback, keys]);   
}