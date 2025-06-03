import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Plus, Trash2, Save, Volume2, RotateCcw, TrendingUp } from 'lucide-react';

// 型定義
interface Pattern {
  id: number;
  name: string;
  beats: number;
  subdivision: number;
  loops: number;
  bpm: number;
}

interface BeatPosition {
  id: string;
  x: number;
  patternIndex: number;
  loopIndex: number;
  beatInLoop: number;
  isFirstBeat: boolean;
}

interface Preset {
  id: number;
  name: string;
  patterns: Pattern[];
}

interface DragInfo {
  beatId: string;
}

// webkitAudioContextの型拡張
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const PolyrhythmMetronome = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBpm, setCurrentBpm] = useState(120);
  const [patterns, setPatterns] = useState<Pattern[]>([
    { id: 1, name: '', beats: 4, subdivision: 4, loops: 2, bpm: 120 }
  ]);
  const [currentPatternIndex, setCurrentPatternIndex] = useState(0);
  const [currentLoop, setCurrentLoop] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [savedPresets, setSavedPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showTempoEditor, setShowTempoEditor] = useState(false);
  const [beatPositions, setBeatPositions] = useState<BeatPosition[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextNoteTimeRef = useRef(0);
  const scheduleAheadTime = 0.1;
  const lookahead = 25.0;
  const timerRef = useRef<number | null>(null);
  const totalBeatsPlayedRef = useRef(0);
  const tempoEditorRef = useRef<HTMLDivElement | null>(null);
  const beatTimingsRef = useRef<number[]>([]);
  
  // スケジューラー内部の状態
  const schedulerState = useRef({
    patternIndex: 0,
    loopCount: 0,
    beatCount: 0
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext!)();
    }
    
    // ローカルストレージからプリセット読み込み
    const saved = localStorage.getItem('metronomePresets');
    if (saved) {
      setSavedPresets(JSON.parse(saved));
    }
    
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const playClick = (beatNumber: number, isFirstBeat: boolean) => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;
    
    const osc = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    
    osc.connect(envelope);
    envelope.connect(audioContext.destination);
    
    // 1拍目は高音、その他は低音
    osc.frequency.value = isFirstBeat ? 1000 : 800;
    envelope.gain.value = 0.3;
    envelope.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.03);
    
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + 0.03);
  };

  // 拍の位置を初期化（拍子の分子のみ）
  const initializeBeatPositions = () => {
    const positions: BeatPosition[] = [];
    let currentX = 0;
    
    patterns.forEach((pattern, pIndex) => {
      for (let loop = 0; loop < pattern.loops; loop++) {
        for (let beat = 0; beat < pattern.beats; beat++) {
          positions.push({
            id: `${pIndex}-${loop}-${beat}`,
            x: currentX,
            patternIndex: pIndex,
            loopIndex: loop,
            beatInLoop: beat,
            isFirstBeat: beat === 0
          });
          currentX += 1;
        }
      }
    });
    
    // 正規化（0-1の範囲に）
    const totalBeats = positions.length;
    positions.forEach((pos, index) => {
      pos.x = index / (totalBeats - 1 || 1);
    });
    
    setBeatPositions(positions);
    updateBeatTimings(positions);
  };

  // 拍の位置から実際の時間間隔を計算
  const updateBeatTimings = (positions: BeatPosition[]) => {
    const timings: number[] = [];
    
    for (let i = 0; i < positions.length - 1; i++) {
      const interval = positions[i + 1].x - positions[i].x;
      timings.push(interval);
    }
    
    beatTimingsRef.current = timings;
  };

  // パターンが変更されたら拍の位置を再初期化
  useEffect(() => {
    if (showTempoEditor) {
      initializeBeatPositions();
    }
  }, [patterns, showTempoEditor]);

  // テンポエディターから次の拍までの時間を取得
  const getNextBeatDuration = (): number | null => {
    if (!showTempoEditor || beatTimingsRef.current.length === 0) return null;
    
    const currentBeatIndex = totalBeatsPlayedRef.current;
    if (currentBeatIndex >= beatTimingsRef.current.length) return null;
    
    // 拍の間隔から実際の秒数を計算
    const totalBeats = patterns.reduce((sum, p) => sum + p.beats * p.loops, 0);
    const totalDuration = patterns.reduce((sum, p) => {
      const beatsInPattern = p.beats * p.loops;
      const beatDuration = 60.0 / (p.bpm * (p.subdivision / 4));
      return sum + beatsInPattern * beatDuration;
    }, 0);
    
    return beatTimingsRef.current[currentBeatIndex] * totalDuration;
  };

  const scheduler = () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;
    
    while (nextNoteTimeRef.current < audioContext.currentTime + scheduleAheadTime) {
      const state = schedulerState.current;
      const pattern = patterns[state.patternIndex];
      
      // 現在の拍を再生（beatCount === 0が1拍目）
      playClick(state.beatCount, state.beatCount === 0);
      
      // 表示を更新
      setCurrentPatternIndex(state.patternIndex);
      setCurrentLoop(state.loopCount);
      setCurrentBeat(state.beatCount);
      
      // 次の拍までの時間を計算
      const customDuration = getNextBeatDuration();
      if (customDuration !== null) {
        // テンポエディターからの時間を使用
        nextNoteTimeRef.current += customDuration;
      } else {
        // 通常の計算
        const beatMultiplier = pattern.subdivision / 4;
        const secondsPerBeat = 60.0 / (pattern.bpm * beatMultiplier);
        nextNoteTimeRef.current += secondsPerBeat;
      }
      
      // 総拍数をカウント
      totalBeatsPlayedRef.current++;
      
      // 状態を進める
      state.beatCount++;
      
      // 拍が終わったら
      if (state.beatCount >= pattern.beats) {
        state.beatCount = 0;
        state.loopCount++;
        
        // ループが終わったら
        if (state.loopCount >= pattern.loops) {
          state.loopCount = 0;
          
          // 次のパターンへ
          if (patterns.length > 1) {
            state.patternIndex = (state.patternIndex + 1) % patterns.length;
          } else {
            // 1パターンのみの場合、総拍数をリセット
            totalBeatsPlayedRef.current = 0;
          }
        }
      }
      
      // 全パターン終了時に総拍数をリセット
      if (state.patternIndex === 0 && state.loopCount === 0 && state.beatCount === 0) {
        totalBeatsPlayedRef.current = 0;
      }
    }
    
    timerRef.current = window.setTimeout(scheduler, lookahead);
  };

  const togglePlay = () => {
    if (!isPlaying) {
      const audioContext = audioContextRef.current;
      if (!audioContext) return;
      
      nextNoteTimeRef.current = audioContext.currentTime;
      
      // スケジューラーの状態をリセット
      schedulerState.current = {
        patternIndex: 0,
        loopCount: 0,
        beatCount: 0
      };
      
      // 表示もリセット
      setCurrentPatternIndex(0);
      setCurrentLoop(0);
      setCurrentBeat(0);
      
      scheduler();
      setIsPlaying(true);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setIsPlaying(false);
      
      // 停止時に表示をリセット
      setCurrentBeat(0);
      setCurrentLoop(0);
      setCurrentPatternIndex(0);
      totalBeatsPlayedRef.current = 0;
    }
  };

  const addPattern = () => {
    const newPattern: Pattern = {
      id: Date.now(),
      name: '',
      beats: 4,
      subdivision: 4,
      loops: 1,
      bpm: 120
    };
    setPatterns([...patterns, newPattern]);
  };

  const updatePattern = (id: number, field: keyof Pattern, value: string | number) => {
    setPatterns(patterns.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const deletePattern = (id: number) => {
    if (patterns.length > 1) {
      setPatterns(patterns.filter(p => p.id !== id));
    }
  };

  const savePreset = () => {
    if (!presetName.trim()) {
      setSaveError('プリセット名を入力してください');
      setTimeout(() => setSaveError(''), 3000);
      return;
    }
    
    const newPreset: Preset = {
      id: Date.now(),
      name: presetName,
      patterns: [...patterns]
    };
    
    const updatedPresets = [...savedPresets, newPreset];
    setSavedPresets(updatedPresets);
    localStorage.setItem('metronomePresets', JSON.stringify(updatedPresets));
    setPresetName('');
    setSaveError('');
  };

  const loadPreset = (preset: Preset) => {
    setPatterns(preset.patterns);
  };

  const clearPatterns = () => {
    setPatterns([
      { id: Date.now(), name: '', beats: 4, subdivision: 4, loops: 2, bpm: 120 }
    ]);
  };

  // マウス移動時の処理
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragInfo || !tempoEditorRef.current) return;
    
    const rect = tempoEditorRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newX = Math.max(0, Math.min(1, x / rect.width));
    
    setBeatPositions(prevPositions => {
      const newPositions = [...prevPositions];
      const dragIndex = prevPositions.findIndex(p => p.id === dragInfo.beatId);
      
      if (dragIndex > 0 && dragIndex < newPositions.length - 1) {
        const minX = newPositions[dragIndex - 1].x + 0.02;
        const maxX = newPositions[dragIndex + 1].x - 0.02;
        newPositions[dragIndex] = {
          ...newPositions[dragIndex],
          x: Math.max(minX, Math.min(maxX, newX))
        };
        updateBeatTimings(newPositions);
      }
      
      return newPositions;
    });
  };

  // マウスアップ時の処理
  const handleMouseUp = () => {
    setIsDragging(false);
    setDragInfo(null);
  };

  // グローバルイベントリスナー
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragInfo, beatPositions]);

  const resetBeatPositions = () => {
    initializeBeatPositions();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">変拍子対応メトロノーム</h1>
        
        {/* 削除確認モーダル */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4">
              <h3 className="text-lg font-semibold mb-2">プリセットの削除</h3>
              <p className="text-gray-300 mb-4">
                「{savedPresets.find(p => p.id === deleteConfirm)?.name}」を削除しますか？
              </p>
              <div className="flex space-x-3 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    const updatedPresets = savedPresets.filter(p => p.id !== deleteConfirm);
                    setSavedPresets(updatedPresets);
                    localStorage.setItem('metronomePresets', JSON.stringify(updatedPresets));
                    setDeleteConfirm(null);
                  }}
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* 再生コントロール */}
        <div className="bg-gray-800 p-6 rounded-lg mb-6">
          <div className="flex items-center justify-center mb-4">
            <button
              onClick={togglePlay}
              className={`p-4 rounded-full ${
                isPlaying ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
              } transition-colors`}
            >
              {isPlaying ? <Pause size={32} /> : <Play size={32} />}
            </button>
          </div>
          
          {isPlaying && (
            <div className="text-center">
              <p className="text-lg">
                パターン: {patterns[currentPatternIndex].name || `${patterns[currentPatternIndex].beats}/${patterns[currentPatternIndex].subdivision}`} | 
                ループ: {currentLoop + 1}/{patterns[currentPatternIndex].loops} | 
                拍: {currentBeat + 1}/{patterns[currentPatternIndex].beats}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                実効BPM: {Math.round(patterns[currentPatternIndex].bpm * patterns[currentPatternIndex].subdivision / 4)}
                {patterns[currentPatternIndex].subdivision !== 4 && 
                  ` (${patterns[currentPatternIndex].subdivision}分音符)`
                }
              </p>
              <div className="flex justify-center mt-2 space-x-2">
                {Array.from({ length: patterns[currentPatternIndex].beats }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full transition-all duration-100 ${
                      i === currentBeat ? 'bg-green-400 scale-125' : 'bg-gray-600'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* テンポエディター */}
        <div className="bg-gray-800 p-6 rounded-lg mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">テンポカーブ</h2>
            <div className="flex items-center space-x-2">
              {showTempoEditor && (
                <button
                  onClick={resetBeatPositions}
                  className="bg-gray-600 hover:bg-gray-700 p-2 rounded"
                  title="リセット"
                >
                  <RotateCcw size={18} />
                </button>
              )}
              <button
                onClick={() => setShowTempoEditor(!showTempoEditor)}
                className={`px-3 py-2 rounded flex items-center ${
                  showTempoEditor ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
                }`}
              >
                <TrendingUp size={18} className="mr-2" />
                {showTempoEditor ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
          
          {showTempoEditor && (
            <div className="space-y-4">
              <div 
                ref={tempoEditorRef}
                className="relative bg-gray-900 rounded h-32 overflow-x-auto overflow-y-hidden select-none"
                style={{ userSelect: 'none' }}
              >
                <div className="relative h-full" style={{ minWidth: '100%' }}>
                  {/* 拍の位置を表示 */}
                  {beatPositions.map((beat, index) => {
                    // 最初の拍以外はすべてドラッグ可能にする
                    const isDraggable = index > 0;
                    const isFirstBeatInLoop = beat.isFirstBeat;
                    
                    return (
                      <div key={beat.id}>
                        {/* 縦線 */}
                        <div
                          className={`absolute top-0 bottom-0 w-px pointer-events-none ${
                            isFirstBeatInLoop ? 'bg-green-500' : 'bg-gray-600'
                          }`}
                          style={{ left: `${beat.x * 100}%` }}
                        />
                        
                        {/* ドラッグ可能な点 */}
                        {isDraggable ? (
                          <button
                            type="button"
                            className={`absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 
                              w-8 h-8 bg-blue-500 rounded-full cursor-ew-resize hover:bg-blue-400 
                              transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300
                              ${isDragging && dragInfo?.beatId === beat.id ? 'ring-4 ring-blue-300 z-10' : ''}`}
                            style={{ left: `${beat.x * 100}%` }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log('Mouse down on beat:', beat.id);
                              setIsDragging(true);
                              setDragInfo({ beatId: beat.id });
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          />
                        ) : (
                          <div
                            className="absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 
                              w-5 h-5 bg-gray-500 rounded-full pointer-events-none"
                            style={{ left: `${beat.x * 100}%` }}
                          />
                        )}
                        
                        {/* 拍番号とパターン情報 */}
                        <div
                          className="absolute top-2 transform -translate-x-1/2 text-xs text-gray-400 pointer-events-none"
                          style={{ left: `${beat.x * 100}%` }}
                        >
                          {beat.beatInLoop + 1}
                        </div>
                        
                        {/* パターン名表示（最初の拍のみ） */}
                        {beat.loopIndex === 0 && beat.beatInLoop === 0 && (
                          <div
                            className="absolute bottom-2 transform -translate-x-1/2 text-xs text-green-400 pointer-events-none"
                            style={{ left: `${beat.x * 100}%` }}
                          >
                            {patterns[beat.patternIndex].name || `${patterns[beat.patternIndex].beats}/${patterns[beat.patternIndex].subdivision}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* 間隔の視覚化 */}
                  {beatPositions.slice(0, -1).map((beat, index) => {
                    const nextBeat = beatPositions[index + 1];
                    const width = (nextBeat.x - beat.x) * 100;
                    const opacity = Math.min(0.3, Math.max(0.05, width / 10));
                    
                    return (
                      <div
                        key={`interval-${beat.id}`}
                        className="absolute top-1/4 h-1/2 bg-blue-400 pointer-events-none"
                        style={{
                          left: `${beat.x * 100}%`,
                          width: `${width}%`,
                          opacity: opacity
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              
              <div className="text-sm text-gray-400 space-y-1">
                <p>• 青い点をドラッグして拍の間隔を調整</p>
                <p>• 間隔が狭い = 速い（accel）、広い = 遅い（rit）</p>
                <p>• 緑の線は各パターンの1拍目</p>
              </div>
            </div>
          )}
        </div>

        {/* パターン設定 */}
        <div className="bg-gray-800 p-6 rounded-lg mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">パターン設定</h2>
            <div className="flex space-x-2">
              <button
                onClick={clearPatterns}
                className="bg-gray-600 hover:bg-gray-700 p-2 rounded flex items-center"
                disabled={isPlaying}
                title="クリア"
              >
                <RotateCcw size={20} />
              </button>
              <button
                onClick={addPattern}
                className="bg-blue-600 hover:bg-blue-700 p-2 rounded"
                disabled={isPlaying}
                title="パターン追加"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>
          
          <div className="space-y-4">
            {patterns.map((pattern, index) => (
              <div key={pattern.id} className="bg-gray-700 p-4 rounded">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div>
                    <label className="text-sm text-gray-400">拍子</label>
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        min="1"
                        max="16"
                        value={pattern.beats}
                        onChange={(e) => updatePattern(pattern.id, 'beats', parseInt(e.target.value))}
                        className="w-12 bg-gray-600 rounded px-2 py-1 text-center"
                        disabled={isPlaying}
                      />
                      <span>/</span>
                      <select
                        value={pattern.subdivision}
                        onChange={(e) => updatePattern(pattern.id, 'subdivision', parseInt(e.target.value))}
                        className="w-12 bg-gray-600 rounded px-1 py-1 text-center"
                        disabled={isPlaying}
                      >
                        <option value="2">2</option>
                        <option value="4">4</option>
                        <option value="8">8</option>
                        <option value="16">16</option>
                        <option value="32">32</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-400">BPM (4分音符基準)</label>
                    <input
                      type="number"
                      min="40"
                      max="300"
                      value={pattern.bpm}
                      onChange={(e) => updatePattern(pattern.id, 'bpm', parseInt(e.target.value))}
                      className="w-full bg-gray-600 rounded px-2 py-1"
                      disabled={isPlaying}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-400">ループ回数</label>
                    <input
                      type="number"
                      min="1"
                      max="16"
                      value={pattern.loops}
                      onChange={(e) => updatePattern(pattern.id, 'loops', parseInt(e.target.value))}
                      className="w-full bg-gray-600 rounded px-2 py-1"
                      disabled={isPlaying}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm text-gray-400">名前</label>
                    <input
                      type="text"
                      value={pattern.name}
                      onChange={(e) => updatePattern(pattern.id, 'name', e.target.value)}
                      className="w-full bg-gray-600 rounded px-2 py-1"
                      disabled={isPlaying}
                    />
                  </div>
                  
                  <div className="flex items-end">
                    <button
                      onClick={() => deletePattern(pattern.id)}
                      className="bg-red-600 hover:bg-red-700 p-2 rounded"
                      disabled={patterns.length === 1 || isPlaying}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                
                {index === currentPatternIndex && isPlaying && (
                  <div className="mt-2 text-green-400 text-sm">▶ 現在再生中</div>
                )}
              </div>
            ))}
          </div>
          
          {/* プリセット保存 */}
          <div className="mt-6 pt-6 border-t border-gray-700">
            <div className="flex space-x-2">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="プリセット名を入力"
                className="flex-1 bg-gray-700 rounded px-3 py-2"
              />
              <button
                onClick={savePreset}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded flex items-center"
                disabled={isPlaying}
              >
                <Save size={16} className="mr-2" />
                プリセット保存
              </button>
            </div>
            {saveError && (
              <p className="text-red-400 text-sm mt-2">{saveError}</p>
            )}
          </div>
        </div>

        {/* プリセット一覧 */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">プリセット一覧</h2>
          
          
          {savedPresets.length === 0 ? (
            <p className="text-gray-400 text-center py-8">
              保存されたプリセットはありません
            </p>
          ) : (
            <div className="space-y-2">
              {savedPresets.map((preset) => (
                <div key={preset.id} className="bg-gray-700 p-3 rounded flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold">{preset.name}</h3>
                    <p className="text-sm text-gray-400">
                      {preset.patterns.every(p => !p.name) 
                        ? preset.patterns.map(p => `${p.beats}/${p.subdivision}`).join(' → ')
                        : preset.patterns.map(p => p.name || `${p.beats}/${p.subdivision}`).join(' → ')
                      }
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => loadPreset(preset)}
                      className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
                      disabled={isPlaying}
                    >
                      読込
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(preset.id)}
                      className="bg-red-600 hover:bg-red-700 p-1 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PolyrhythmMetronome;