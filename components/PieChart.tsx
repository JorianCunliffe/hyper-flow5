import React from 'react';
import { PieChart as RePieChart, Pie, Cell } from 'recharts';
import { Subtask } from '../types';
import { getStatusColor } from '../constants';

interface PieChartProps {
  subtasks: Subtask[];
  size?: number;
}

export const MilestonePieChart: React.FC<PieChartProps> = ({ subtasks = [], size = 120 }) => {
  const safeSubtasks = subtasks || [];
  const dataMap = safeSubtasks.reduce((acc, sub) => {
    acc[sub.status] = (acc[sub.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statuses = Object.keys(dataMap);
  const data = statuses.map(status => ({
    name: status,
    value: dataMap[status],
    color: getStatusColor(status)
  })).filter(d => d.value > 0);

  if (data.length === 0) {
    data.push({ name: 'Empty', value: 1, color: '#f1f5f9' });
  }

  const completeCount = dataMap['Complete'] || 0;
  const totalCount = safeSubtasks.length || 1;

  return (
    <div style={{ width: size, height: size }} className="relative">
      <RePieChart width={size} height={size}>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={size * 0.25}
          outerRadius={size * 0.45}
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
      </RePieChart>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[10px] font-bold text-slate-500">
          {Math.round((completeCount / totalCount) * 100)}%
        </span>
      </div>
    </div>
  );
};