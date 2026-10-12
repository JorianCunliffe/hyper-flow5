import React, { useMemo } from 'react';
import { checkProjectHours, type ProjectOperatingHours } from '../lib/projectHours';

export function ProjectHoursEditor({ value, onChange }: { value?: ProjectOperatingHours; onChange: (value: ProjectOperatingHours) => void }) {
  const hours = value || { timezone: 'Australia/Brisbane', windows: [] };
  const preview = useMemo(() => { let preview = 'Open — no opening hours configured.';
  try { if (value) { const result = checkProjectHours(value); preview = `${result.hours_status === 'open' ? 'Open' : 'Closed'} now (${result.hours_local_time}, ${hours.timezone}).${result.hours_next_open_at ? ` Next opening: ${new Date(result.hours_next_open_at).toLocaleString('en-AU', { timeZone: hours.timezone })}.` : ''}`; } }
  catch { preview = 'Complete the timezone and hours to see a preview.'; }
  return preview; }, [value]);
  return <fieldset className="space-y-3 rounded-xl border border-cyan-200 p-4">
    <legend className="font-bold">Project hours of operation</legend>
    <p className="text-sm">Use a Check project hours step in your workflow, followed by a Decision. These settings do not automatically block calls or messages.</p>
    <label className="block">Timezone <input aria-label="Project hours timezone" value={hours.timezone} onChange={e => onChange({ ...hours, timezone: e.target.value })} className="border rounded p-2" /></label>
    {hours.windows.map((window, index) => <div key={index} className="rounded border p-2 space-y-2">
      <div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, number) => <label key={day} className="mr-2"><input type="checkbox" checked={window.days.includes(number)} onChange={e => onChange({ ...hours, windows: hours.windows.map((w,i) => i===index ? { ...w, days: e.target.checked ? [...w.days,number] : w.days.filter(d=>d!==number) } : w) })} />{day}</label>)}</div>
      <label>Opens <input type="time" value={window.start} onChange={e=>onChange({...hours,windows:hours.windows.map((w,i)=>i===index?{...w,start:e.target.value}:w)})} /></label>
      <label> Closes <input aria-label={`Closing time ${index+1}`} placeholder="HH:mm or 24:00" value={window.end} onChange={e=>onChange({...hours,windows:hours.windows.map((w,i)=>i===index?{...w,end:e.target.value}:w)})} /></label>
      <button type="button" onClick={()=>onChange({...hours,windows:hours.windows.filter((_,i)=>i!==index)})}>Remove hours window</button>
    </div>)}
    <button type="button" disabled={hours.windows.length >= 28} onClick={()=>onChange({...hours,windows:[...hours.windows,{days:[1,2,3,4,5],start:'09:00',end:'17:00'}]})}>Add hours window</button>
    <p className="text-xs">An end before the start means overnight. No windows means closed; 00:00–24:00 means all day.</p>
    <label className="block">Closed dates (YYYY-MM-DD, one per line)<textarea className="block border rounded p-2" value={hours.closures?.join('\n') || ''} onChange={e=>onChange({...hours,closures:e.target.value.split('\n').map(s=>s.trim()).filter(Boolean)})}/></label>
    <p role="status">{preview}</p>
  </fieldset>;
}
