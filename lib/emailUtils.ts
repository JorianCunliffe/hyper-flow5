import React from 'react';

export const sendTaskEmail = async (
  email: string,
  task: { 
    name: string; 
    displayId?: string; 
    description?: string; 
    notes?: string; 
    status: string; 
    dueDate?: string 
  },
  projectName: string,
  milestoneName: string
) => {
  const subject = `[ProjectFlow] Task ${task.displayId || ''}: ${task.name}`;
  
  const appUrl = 'https://projectflow.online';
  const directLink = `${appUrl}/?projectId=${encodeURIComponent(projectName.replace(/\s+/g, '_'))}&taskId=${task.displayId || ''}`;

  let htmlParts = [
    `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #eee; border-radius: 8px;">`,
    `<h2 style="color: #4f46e5; margin-top: 0;">Task: ${task.name}</h2>`,
    `<div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin-bottom: 20px;">`,
    `<ul style="list-style: none; padding: 0; margin: 0;">`,
    `<li style="margin-bottom: 8px;"><b>ID:</b> <span style="color: #64748b;">${task.displayId || 'N/A'}</span></li>`,
    `<li style="margin-bottom: 8px;"><b>Project:</b> <span style="color: #64748b;">${projectName}</span></li>`,
    `<li style="margin-bottom: 8px;"><b>Milestone:</b> <span style="color: #64748b;">${milestoneName}</span></li>`,
    `<li style="margin-bottom: 8px;"><b>Status:</b> <span style="color: #64748b;">${task.status}</span></li>`,
  ];

  if (task.dueDate) {
    htmlParts.push(`<li style="margin-bottom: 0;"><b>Due Date:</b> <span style="color: #64748b;">${task.dueDate}</span></li>`);
  }
  htmlParts.push(`</ul></div>`);

  if (task.description) {
    htmlParts.push(`<h3 style="font-size: 16px; margin-bottom: 8px; color: #1e293b;">Description:</h3>`);
    htmlParts.push(`<div style="color: #475569; line-height: 1.5; margin-bottom: 20px;">${task.description.replace(/\\n/g, '<br>')}</div>`);
  }

  if (task.notes) {
    htmlParts.push(`<h3 style="font-size: 16px; margin-bottom: 8px; color: #1e293b;">Notes:</h3>`);
    htmlParts.push(`<div style="color: #475569; line-height: 1.5; margin-bottom: 20px;">${task.notes.replace(/\\n/g, '<br>')}</div>`);
  }

  htmlParts.push(`<div style="margin-top: 30px; margin-bottom: 20px;">`);
  htmlParts.push(`<a href="${directLink}" style="background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">&rarr; View & Update Task</a>`);
  htmlParts.push(`</div>`);

  htmlParts.push(`<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />`);
  htmlParts.push(`<p style="color: #94a3b8; font-size: 12px; margin: 0;"><i>Sent via ProjectFlow</i></p>`);
  htmlParts.push(`</div>`);

  const html = htmlParts.join('\n');
  
  const response = await fetch('/api/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: email,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || 'Failed to send email');
  }

  return response.json();
};
