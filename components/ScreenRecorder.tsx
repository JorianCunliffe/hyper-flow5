import React, { useState, useRef } from 'react';
import { Video, Mic, Square, Play, Loader2, Link2, Trash2 } from 'lucide-react';
import { firebaseService } from '../services/firebaseService';

interface ScreenRecorderProps {
  taskId: string;
  existingUrl?: string;
  onUploadSuccess: (url: string, type: 'video' | 'audio') => void;
  onRemove: () => void;
}

export const ScreenRecorder: React.FC<ScreenRecorderProps> = ({ taskId, existingUrl, onUploadSuccess, onRemove }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingType, setRecordingType] = useState<null | 'video' | 'audio'>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const startRecording = async (type: 'video' | 'audio') => {
    try {
      chunksRef.current = [];
      let stream: MediaStream;

      if (type === 'video') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // We'll also try to get mic audio
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStream.getAudioTracks().forEach(track => displayStream.addTrack(track));
        } catch (e) {
          console.warn("No mic audio added", e);
        }
        stream = displayStream;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: type === 'video' ? 'video/webm' : 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsUploading(true);
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunksRef.current, { type: type === 'video' ? 'video/webm' : 'audio/webm' });
        try {
          const url = await firebaseService.uploadRecording(blob, taskId);
          if (url) {
            onUploadSuccess(url, type);
          }
        } catch (error: any) {
          console.error("Upload failed", error);
          let errMsg = error.message || 'Unknown error';
          if (errMsg.includes('permission')) {
             errMsg = 'Firebase Storage rules are blocking the upload. Please allow public writes in your Firebase Console, or set up Authentication.';
          } else if (error.name === 'FirebaseError') {
             errMsg = 'Firebase Error: ' + errMsg + '. Note: Ensure you have configured CORS for your storage bucket.';
          }
          alert("Failed to upload recording: " + errMsg);
        } finally {
          setIsUploading(false);
          setRecordingType(null);
        }
      };

      mediaRecorder.start();
      setRecordingType(type);
      setIsRecording(true);
    } catch (err) {
      console.error("Recording failed to start", err);
      // alert("Could not start recording. Check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  if (existingUrl) {
    return (
      <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
        <a 
          href={existingUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex-1 flex items-center gap-2 text-indigo-700 font-bold hover:text-indigo-800 transition-colors"
        >
          <Play size={16} /> View Attached Recording
        </a>
        <button 
          onClick={onRemove}
          className="p-1.5 text-indigo-400 hover:text-red-500 hover:bg-white rounded-lg transition-all"
          title="Remove Recording"
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Feedback & Recordings</label>
        {isRecording && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-red-500 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500"></span> Recording {recordingType}
          </span>
        )}
      </div>

      {isUploading ? (
        <div className="flex items-center gap-2 text-slate-500 justify-center p-3 animate-in fade-in">
          <Loader2 className="animate-spin" size={16} /> Uploading...
        </div>
      ) : isRecording ? (
        <button 
          onClick={stopRecording}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-100 text-red-700 font-bold rounded-lg border border-red-200 hover:bg-red-200 transition-colors"
        >
          <Square size={16} /> Stop Recording
        </button>
      ) : (
        <div className="flex gap-2">
          <button 
            onClick={() => startRecording('video')}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-white text-slate-700 font-bold rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            <Video size={16} className="text-indigo-500" /> Screen & Audio
          </button>
          <button 
            onClick={() => startRecording('audio')}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-white text-slate-700 font-bold rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            <Mic size={16} className="text-emerald-500" /> Audio Only
          </button>
        </div>
      )}
    </div>
  );
};
