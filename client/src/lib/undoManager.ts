import { useState, useEffect, useCallback } from "react";

type UndoAction = {
  description: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
};

const MAX_STACK = 50;

class UndoManager {
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private listeners: Set<() => void> = new Set();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  push(action: UndoAction) {
    this.undoStack.push(action);
    if (this.undoStack.length > MAX_STACK) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  async undo(): Promise<string | null> {
    const action = this.undoStack.pop();
    if (!action) return null;
    await action.undo();
    this.redoStack.push(action);
    this.notify();
    return action.description;
  }

  async redo(): Promise<string | null> {
    const action = this.redoStack.pop();
    if (!action) return null;
    await action.redo();
    this.undoStack.push(action);
    this.notify();
    return action.description;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoDescription() { return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].description : null; }
  get redoDescription() { return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].description : null; }
  get undoCount() { return this.undoStack.length; }
  get redoCount() { return this.redoStack.length; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}

export const homeUndoManager = new UndoManager();
export const projectUndoManager = new UndoManager();

export function useUndo(manager: UndoManager) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return manager.subscribe(() => forceUpdate((n: number) => n + 1));
  }, [manager]);

  const undo = useCallback(async () => {
    return manager.undo();
  }, [manager]);

  const redo = useCallback(async () => {
    return manager.redo();
  }, [manager]);

  return {
    undo,
    redo,
    canUndo: manager.canUndo,
    canRedo: manager.canRedo,
    undoDescription: manager.undoDescription,
    redoDescription: manager.redoDescription,
    undoCount: manager.undoCount,
    redoCount: manager.redoCount,
    push: manager.push.bind(manager),
    clear: manager.clear.bind(manager),
  };
}
