import React, { useState, useRef, useEffect } from 'react';
import { Flag, Trash2, GripHorizontal } from 'lucide-react';

interface TimelineMarkerProps {
  marker: { id: string; name: string; x: number };
  top: number;
  height: number;
  onMove: (id: string, newX: number) => void;
  onUpdateName: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export const TimelineMarker: React.FC<TimelineMarkerProps> = ({
  marker,
  top,
  height,
  onMove,
  onUpdateName,
  onDelete
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(marker.name);
  const [isDragging, setIsDragging] = useState(false);
  const startDragX = useRef(0);
  const startMarkerX = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || isEditing) return;
    e.stopPropagation();
    setIsDragging(true);
    startDragX.current = e.clientX;
    startMarkerX.current = marker.x;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Simple drag implementation
      const el = document.querySelector('.mindmap-container') as HTMLElement;
      const zoom = el ? parseFloat(el.getAttribute('data-zoom') || '1') : 1;
      
      const dx = (e.clientX - startDragX.current) / zoom;
      onMove(marker.id, startMarkerX.current + dx);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, marker.id, onMove]);

  const handleBlur = () => {
    setIsEditing(false);
    if (name.trim()) onUpdateName(marker.id, name);
    else setName(marker.name);
  };

  return (
    <div 
      className="absolute w-0 z-0" 
      style={{ left: marker.x, top: top, height: height }}
    >
      {/* The Line */}
      <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-slate-300 w-0 pointer-events-none" />

      {/* The Header / Handle */}
      <div 
        className="absolute -top-7 -left-20 w-40 flex flex-col items-center group z-20"
      >
        <div 
          className={`flex items-center gap-2 bg-white px-2 py-1 rounded-md shadow-sm border border-slate-200 transition-all cursor-ew-resize hover:border-indigo-400 hover:shadow-md ${isDragging ? 'cursor-grabbing shadow-md border-indigo-500 ring-2 ring-indigo-100' : ''}`}
          onMouseDown={handleMouseDown}
        >
          <GripHorizontal size={14} className="text-slate-400" />
          
          {isEditing ? (
            <input 
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-24 text-xs font-bold text-slate-700 outline-none bg-transparent uppercase tracking-wider"
            />
          ) : (
            <span 
              onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
              className="text-xs font-bold text-slate-600 uppercase tracking-wider cursor-text hover:text-indigo-600"
            >
              {marker.name}
            </span>
          )}

          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(marker.id); }}
            className="text-slate-300 hover:text-red-500 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
        
        {/* Downward Arrow Indicator */}
        <div className="w-0.5 h-3 bg-indigo-500/20 mt-0.5" />
      </div>
    </div>
  );
};