"use client";

import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ChartZoomControlsProps {
  label: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/** Consistent visible zoom controls for interactive time-series charts. */
export function ChartZoomControls({ label, onZoomIn, onZoomOut, onReset }: ChartZoomControlsProps) {
  return <div className="flex items-center gap-1" aria-label={`${label} zoom controls`}>
    <Button variant="icon" onClick={onZoomOut} aria-label={`Zoom out ${label}`} title="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
    <Button variant="icon" onClick={onZoomIn} aria-label={`Zoom in ${label}`} title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
    <Button variant="icon" onClick={onReset} aria-label={`Reset ${label} zoom`} title="Reset zoom"><RotateCcw className="h-4 w-4" /></Button>
  </div>;
}
