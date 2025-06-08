import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Plus, Trash2, Save, RotateCcw, TrendingUp, ChevronLeft, ChevronRight, Share2, Upload, Copy, Check } from 'lucide-react';

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
  tempoCurve?: {
    enabled: boolean;
    customIntervals: Array<[number, number]>; // MapをArrayに変換して保存
    beatPositions: BeatPosition[];
  };
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
  const [deletePatternConfirm, setDeletePatternConfirm] = useState<number | null>(null);
  const [showTempoEditor, setShowTempoEditor] = useState(false);
  const [beatPositions, setBeatPositions] = useState<BeatPosition[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [_hasCustomTempo, setHasCustomTempo] = useState(false);
  const [initialPositions, setInitialPositions] = useState<BeatPosition[]>([]);
  const [_modifiedBeats, setModifiedBeats] = useState<Set<number>>(new Set());
  const [customIntervals, setCustomIntervals] = useState<Map<number, number>>(new Map());
  const [showShareModal, setShowShareModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [sharePreset, setSharePreset] = useState<Preset | null>(null);
  const [shareData, setShareData] = useState('');
  const [importData, setImportData] = useState('');
  const [importError, setImportError] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  
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

  const playClick = (_beatNumber: number, isFirstBeat: boolean) => {
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
    
    // 拍の位置を0-0.85の範囲で正規化（右端にも動かせる余地を残す）
    const totalBeats = positions.length;
    positions.forEach((pos, index) => {
      pos.x = (index / (totalBeats - 1 || 1)) * 0.85;
    });
    
    // 初期位置を保存（変化率計算用）
    const initialPos = positions.map(pos => ({ ...pos }));
    
    setBeatPositions(positions);
    updateBeatTimings(positions);
    setHasCustomTempo(false); // 初期化時はカスタムテンポなし
    setInitialPositions(initialPos); // 初期位置を保存
    setModifiedBeats(new Set()); // 動かされた拍の記録をクリア
    setCustomIntervals(new Map()); // カスタム間隔をクリア
    
    // 初期化時はbeatTimingsRefもクリアして、カスタムテンポを無効化
    beatTimingsRef.current = [];
  };

  // 拍の位置から実際の時間間隔を計算
  const updateBeatTimings = (positions: BeatPosition[]) => {
    // UIの位置は無視して、カスタム間隔Mapのみを使用
    const totalBeats = positions.length;
    const baseInterval = 1.0 / (totalBeats - 1 || 1);
    
    // カスタム間隔が設定されている場合はそれを使用、そうでなければ基準間隔
    const timings = [];
    for (let i = 0; i < totalBeats - 1; i++) {
      timings[i] = customIntervals.has(i) ? customIntervals.get(i)! : baseInterval;
    }
    
    beatTimingsRef.current = timings;
  };

  // パターンが変更されたら拍の位置を再初期化
  useEffect(() => {
    if (showTempoEditor) {
      // パターンの総拍数を計算
      const totalBeats = patterns.reduce((sum, pattern) => sum + (pattern.beats * pattern.loops), 0);
      const currentBeatCount = beatPositions.length;
      
      // 総拍数が変化した場合のみ初期化
      if (totalBeats !== currentBeatCount || beatPositions.some(beat => !patterns[beat.patternIndex])) {
        initializeBeatPositions();
      }
    }
  }, [patterns.map(p => `${p.id}-${p.beats}-${p.loops}`).join(','), showTempoEditor]);

  // テンポエディターから次の拍までの時間を取得
  const getNextBeatDuration = (): number | null => {
    // カスタム間隔が実際に設定されていない場合は通常のテンポを使用
    if (!showTempoEditor || customIntervals.size === 0 || beatTimingsRef.current.length === 0) return null;
    
    const currentBeatIndex = totalBeatsPlayedRef.current;
    if (currentBeatIndex >= beatTimingsRef.current.length) return null;
    
    // この間隔がカスタマイズされていない場合は通常のテンポを使用
    if (!customIntervals.has(currentBeatIndex)) return null;
    
    // 現在の拍が属するパターンを特定
    const state = schedulerState.current;
    const pattern = patterns[state.patternIndex];
    
    // このパターンの元の1拍時間を計算
    const beatMultiplier = pattern.subdivision / 4;
    const originalBeatDuration = 60.0 / (pattern.bpm * beatMultiplier);
    
    // カスタム間隔の変化率を取得
    const baseInterval = 1.0 / (beatTimingsRef.current.length || 1);
    const customInterval = customIntervals.get(currentBeatIndex)!;
    const changeRatio = customInterval / baseInterval;
    
    // 元の1拍時間に変化率を適用
    return originalBeatDuration * changeRatio;
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
      patterns: [...patterns],
      tempoCurve: showTempoEditor ? {
        enabled: true,
        customIntervals: Array.from(customIntervals.entries()),
        beatPositions: [...beatPositions]
      } : undefined
    };
    
    const updatedPresets = [...savedPresets, newPreset];
    setSavedPresets(updatedPresets);
    localStorage.setItem('metronomePresets', JSON.stringify(updatedPresets));
    setPresetName('');
    setSaveError('');
  };

  const loadPreset = (preset: Preset) => {
    setPatterns(preset.patterns);
    
    // テンポカーブ情報がある場合は復元
    if (preset.tempoCurve) {
      setShowTempoEditor(preset.tempoCurve.enabled);
      if (preset.tempoCurve.enabled) {
        // カスタム間隔を復元
        const restoredIntervals = new Map(preset.tempoCurve.customIntervals);
        setCustomIntervals(restoredIntervals);
        
        // 拍の位置を復元
        setBeatPositions(preset.tempoCurve.beatPositions);
        updateBeatTimings(preset.tempoCurve.beatPositions);
        
        setHasCustomTempo(restoredIntervals.size > 0);
      }
    } else {
      // テンポカーブ情報がない場合は初期化
      setShowTempoEditor(false);
      setHasCustomTempo(false);
      setCustomIntervals(new Map());
      setBeatPositions([]);
      beatTimingsRef.current = [];
    }
  };

  const clearPatterns = () => {
    setPatterns([
      { id: Date.now(), name: '', beats: 4, subdivision: 4, loops: 2, bpm: 120 }
    ]);
  };

  // マウス移動時の処理
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragInfo || !tempoEditorRef.current) return;
    
    // スクロールコンテナ（親要素）の情報を取得
    const scrollContainer = tempoEditorRef.current.parentElement;
    if (!scrollContainer) return;
    
    // スクロールコンテナ基準での座標計算
    const containerRect = scrollContainer.getBoundingClientRect();
    const scrollLeft = scrollContainer.scrollLeft;
    
    // マウス位置をスクロールコンテナ内の座標に変換
    const containerX = e.clientX - containerRect.left;
    const absoluteX = containerX + scrollLeft;
    
    // エディターの実際の幅
    const editorWidth = tempoEditorRef.current.offsetWidth;
    
    // 0-1の範囲での位置（エディター全体に対する割合）
    const positionRatio = absoluteX / editorWidth;
    
    // 85%表示の逆算: 表示位置 = beat.x * 85% なので、beat.x = 表示位置 / 85%
    const normalizedX = positionRatio / 0.85;
    const clampedX = Math.max(0, Math.min(1, normalizedX));
    
    setBeatPositions(prevPositions => {
      const newPositions = [...prevPositions];
      const dragIndex = prevPositions.findIndex(p => p.id === dragInfo.beatId);
      
      if (dragIndex > 0) {
        // 最初の拍以外はすべて動かせる
        let minX = newPositions[dragIndex - 1].x + 0.01;
        let maxX = 1.0; // 最大1.0まで（85%表示で実際は85%位置）
        
        // 最後の拍でない場合は、次の拍との制約を設ける
        if (dragIndex < newPositions.length - 1) {
          maxX = Math.min(maxX, newPositions[dragIndex + 1].x - 0.01);
        }
        
        newPositions[dragIndex] = {
          ...newPositions[dragIndex],
          x: Math.max(minX, Math.min(maxX, clampedX))
        };
        
        // カスタム間隔を計算して保存
        const totalBeats = newPositions.length;
        const baseInterval = 1.0 / (totalBeats - 1 || 1);
        const newCustomIntervals = new Map(customIntervals);
        
        // 動かされた拍に関わる間隔のみを更新
        const affectedIntervals = [dragIndex - 1, dragIndex].filter(i => i >= 0 && i < totalBeats - 1);
        
        for (const i of affectedIntervals) {
          const currentInterval = newPositions[i + 1].x - newPositions[i].x;
          const initialInterval = initialPositions[i + 1].x - initialPositions[i].x;
          const changeRatio = currentInterval / initialInterval;
          newCustomIntervals.set(i, baseInterval * changeRatio);
        }
        
        setCustomIntervals(newCustomIntervals);
        updateBeatTimings(newPositions);
        setHasCustomTempo(true); // 拍の位置が変更されたのでカスタムテンポを有効化
        
        // 動かされた拍を記録
        setModifiedBeats(prev => new Set(prev).add(dragIndex));
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
    setHasCustomTempo(false); // リセット時はカスタムテンポを無効化
    setModifiedBeats(new Set()); // 動かされた拍の記録をクリア
    setCustomIntervals(new Map()); // カスタム間隔をクリア
    beatTimingsRef.current = []; // beatTimingsRefもクリア
  };

  // プリセット共有機能
  const sharePresetFunction = (preset: Preset) => {
    const shareData = btoa(JSON.stringify(preset));
    setSharePreset(preset);
    setShareData(shareData);
    setShowShareModal(true);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareData);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('クリップボードへのコピーに失敗しました:', err);
    }
  };

  const importPreset = () => {
    if (!importData.trim()) {
      setImportError('インポートデータを入力してください');
      return;
    }

    try {
      // Base64デコードを試行
      let presetData;
      try {
        presetData = JSON.parse(atob(importData.trim()));
      } catch {
        // Base64でない場合は直接JSONとしてパース
        presetData = JSON.parse(importData.trim());
      }

      // プリセットデータの検証
      if (!presetData.name || !Array.isArray(presetData.patterns)) {
        throw new Error('無効なプリセット形式です');
      }

      // パターンの検証
      for (const pattern of presetData.patterns) {
        if (!pattern.hasOwnProperty('beats') || !pattern.hasOwnProperty('subdivision') || 
            !pattern.hasOwnProperty('loops') || !pattern.hasOwnProperty('bpm')) {
          throw new Error('無効なパターン形式です');
        }
      }

      // 重複チェック（名前が同じプリセットがある場合は番号を付加）
      let importName = presetData.name;
      let counter = 1;
      while (savedPresets.some(p => p.name === importName)) {
        importName = `${presetData.name} (${counter})`;
        counter++;
      }

      const newPreset: Preset = {
        id: Date.now(),
        name: importName,
        patterns: presetData.patterns.map((p: any) => ({
          id: Date.now() + Math.random(),
          name: p.name || '',
          beats: p.beats,
          subdivision: p.subdivision,
          loops: p.loops,
          bpm: p.bpm
        })),
        tempoCurve: presetData.tempoCurve ? {
          enabled: presetData.tempoCurve.enabled,
          customIntervals: presetData.tempoCurve.customIntervals || [],
          beatPositions: presetData.tempoCurve.beatPositions || []
        } : undefined
      };

      const updatedPresets = [...savedPresets, newPreset];
      setSavedPresets(updatedPresets);
      localStorage.setItem('metronomePresets', JSON.stringify(updatedPresets));
      
      setImportData('');
      setImportError('');
      setShowImportModal(false);
    } catch (error) {
      setImportError('インポートに失敗しました。データ形式を確認してください。');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">カスタムメトロノーム</h1>
        
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

        {/* パターン削除確認モーダル */}
        {deletePatternConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4">
              <h3 className="text-lg font-semibold mb-2">パターンの削除</h3>
              <p className="text-gray-300 mb-4">
                「{patterns.find(p => p.id === deletePatternConfirm)?.name || 'このパターン'}」を削除しますか？
              </p>
              <div className="flex space-x-3 justify-end">
                <button
                  onClick={() => setDeletePatternConfirm(null)}
                  className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    deletePattern(deletePatternConfirm);
                    setDeletePatternConfirm(null);
                  }}
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* 共有モーダル */}
        {showShareModal && sharePreset && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">プリセットの共有</h3>
              <p className="text-gray-300 mb-2">「{sharePreset.name}」</p>
              <p className="text-sm text-gray-400 mb-4">
                以下のデータをコピーして他の人に共有してください
              </p>
              <div className="bg-gray-900 p-3 rounded mb-4">
                <textarea
                  value={shareData}
                  readOnly
                  className="w-full h-32 bg-transparent text-sm text-gray-300 resize-none border-none outline-none"
                  onClick={(e) => e.currentTarget.select()}
                />
              </div>
              <div className="flex space-x-3 justify-end">
                <button
                  onClick={() => setShowShareModal(false)}
                  className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded"
                >
                  閉じる
                </button>
                <button
                  onClick={copyToClipboard}
                  className={`px-4 py-2 rounded flex items-center ${
                    copySuccess ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {copySuccess ? <Check size={16} className="mr-2" /> : <Copy size={16} className="mr-2" />}
                  {copySuccess ? 'コピー完了！' : 'コピー'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* インポートモーダル */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">プリセットのインポート</h3>
              <p className="text-sm text-gray-400 mb-4">
                共有されたプリセットデータを貼り付けてください
              </p>
              <textarea
                value={importData}
                onChange={(e) => {
                  setImportData(e.target.value);
                  setImportError('');
                }}
                placeholder="プリセットデータを貼り付け..."
                className="w-full h-32 bg-gray-700 rounded px-3 py-2 text-sm resize-none mb-4"
              />
              {importError && (
                <p className="text-red-400 text-sm mb-4">{importError}</p>
              )}
              <div className="flex space-x-3 justify-end">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportData('');
                    setImportError('');
                  }}
                  className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded"
                >
                  キャンセル
                </button>
                <button
                  onClick={importPreset}
                  className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded flex items-center"
                >
                  <Upload size={16} className="mr-2" />
                  インポート
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



        {/* プリセット設定エリア */}
        <div className="bg-gray-700 p-1 rounded-lg mb-6">
          <div className="bg-gray-800 p-6 rounded-lg mb-4">
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
                                  <div className="relative">
                  {/* 削除ボタンを右上に配置 */}
                  <button
                    onClick={() => setDeletePatternConfirm(pattern.id)}
                    className="absolute top-0 right-0 bg-red-600 hover:bg-red-700 p-1 rounded z-10"
                    disabled={patterns.length === 1 || isPlaying}
                    title="パターンを削除"
                  >
                    <Trash2 size={14} />
                  </button>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pr-10">
                    <div>
                      <label className="text-sm text-gray-400 block mb-2">拍子</label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updatePattern(pattern.id, 'beats', Math.max(1, pattern.beats - 1))}
                          className="bg-gray-600 hover:bg-gray-500 px-1.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                          disabled={isPlaying || pattern.beats <= 1}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="32"
                          value={pattern.beats}
                          onChange={(e) => updatePattern(pattern.id, 'beats', parseInt(e.target.value))}
                          className="w-12 bg-gray-600 rounded px-1 py-1 text-center text-sm flex-shrink-0"
                          disabled={isPlaying}
                        />
                        <button
                          onClick={() => updatePattern(pattern.id, 'beats', Math.min(32, pattern.beats + 1))}
                          className="bg-gray-600 hover:bg-gray-500 px-1.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                          disabled={isPlaying || pattern.beats >= 32}
                        >
                          <ChevronRight size={12} />
                        </button>
                        <span className="text-gray-400 text-sm mx-0.5">/</span>
                        <select
                          value={pattern.subdivision}
                          onChange={(e) => updatePattern(pattern.id, 'subdivision', parseInt(e.target.value))}
                          className="w-12 bg-gray-600 rounded px-1 py-1 text-center text-sm flex-shrink-0"
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
                      <label className="text-sm text-gray-400 block mb-2">BPM (4分音符基準)</label>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updatePattern(pattern.id, 'bpm', Math.max(40, pattern.bpm - 1))}
                          className="bg-gray-600 hover:bg-gray-500 px-1.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                          disabled={isPlaying || pattern.bpm <= 40}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <input
                          type="number"
                          min="40"
                          max="300"
                          value={pattern.bpm}
                          onChange={(e) => updatePattern(pattern.id, 'bpm', parseInt(e.target.value))}
                          className="flex-1 bg-gray-600 rounded px-2 py-1 text-center text-sm"
                          disabled={isPlaying}
                        />
                        <button
                          onClick={() => updatePattern(pattern.id, 'bpm', Math.min(300, pattern.bpm + 1))}
                          className="bg-gray-600 hover:bg-gray-500 px-1.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                          disabled={isPlaying || pattern.bpm >= 300}
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                      <input
                        type="range"
                        min="40"
                        max="300"
                        value={pattern.bpm}
                        onChange={(e) => updatePattern(pattern.id, 'bpm', parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider mt-1"
                        disabled={isPlaying}
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm text-gray-400 block mb-2">ループ回数</label>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updatePattern(pattern.id, 'loops', Math.max(1, pattern.loops - 1))}
                          className="bg-gray-600 hover:bg-gray-500 px-1.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                          disabled={isPlaying || pattern.loops <= 1}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="32"
                          value={pattern.loops}
                          onChange={(e) => updatePattern(pattern.id, 'loops', parseInt(e.target.value))}
                          className="flex-1 bg-gray-600 rounded px-2 py-1 text-center text-sm"
                          disabled={isPlaying}
                        />
                        <button
                          onClick={() => updatePattern(pattern.id, 'loops', Math.min(32, pattern.loops + 1))}
                          className="bg-gray-600 hover:bg-gray-500 px-1.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                          disabled={isPlaying || pattern.loops >= 32}
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="32"
                        value={pattern.loops}
                        onChange={(e) => updatePattern(pattern.id, 'loops', parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider mt-1"
                        disabled={isPlaying}
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm text-gray-400 block mb-2">名前</label>
                      <input
                        type="text"
                        value={pattern.name}
                        onChange={(e) => updatePattern(pattern.id, 'name', e.target.value)}
                        className="w-full bg-gray-600 rounded px-2 py-1 text-sm"
                        disabled={isPlaying}
                      />
                    </div>
                  </div>
                </div>
                  
                  {index === currentPatternIndex && isPlaying && (
                    <div className="mt-2 text-green-400 text-sm">▶ 現在再生中</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg mb-4">
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
                <div className="bg-gray-900 rounded h-32 overflow-x-auto overflow-y-hidden">
                  <div 
                    ref={tempoEditorRef}
                    className="relative h-full select-none"
                    style={{ 
                      userSelect: 'none',
                      width: `${Math.max(100, beatPositions.length * 40 + 200)}px`,
                      minWidth: '100%'
                    }}
                  >
                    <div className="relative h-full w-full">
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
                              style={{ left: `${beat.x * 85}%` }}
                            />
                            
                            {/* ドラッグ可能な点 */}
                            {isDraggable ? (
                              <button
                                type="button"
                                className={`absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 
                                  w-8 h-8 bg-blue-500 rounded-full cursor-ew-resize hover:bg-blue-400 
                                  transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300
                                  ${isDragging && dragInfo?.beatId === beat.id ? 'ring-4 ring-blue-300 z-10' : ''}`}
                                style={{ left: `${beat.x * 85}%` }}
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
                                style={{ left: `${beat.x * 85}%` }}
                              />
                            )}
                            
                            {/* 拍番号とパターン情報 */}
                            <div
                              className="absolute top-2 transform -translate-x-1/2 text-xs text-gray-400 pointer-events-none"
                              style={{ left: `${beat.x * 85}%` }}
                            >
                              {beat.beatInLoop + 1}
                            </div>
                            
                            {/* パターン名表示（最初の拍のみ） */}
                            {beat.loopIndex === 0 && beat.beatInLoop === 0 && patterns[beat.patternIndex] && (
                              <div
                                className="absolute bottom-2 transform -translate-x-1/2 text-xs text-green-400 pointer-events-none"
                                style={{ left: `${beat.x * 85}%` }}
                                onClick={() => {
                                  console.log('Pattern debug:', {
                                    beatId: beat.id,
                                    patternIndex: beat.patternIndex,
                                    pattern: patterns[beat.patternIndex],
                                    allPatterns: patterns.length,
                                    allBeats: beatPositions.length
                                  });
                                }}
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
                        const width = (nextBeat.x - beat.x) * 85;
                        const opacity = Math.min(0.3, Math.max(0.05, width / 8));
                        
                        return (
                          <div
                            key={`interval-${beat.id}`}
                            className="absolute top-1/4 h-1/2 bg-blue-400 pointer-events-none"
                            style={{
                              left: `${beat.x * 85}%`,
                              width: `${width}%`,
                              opacity: opacity
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
                
                <div className="text-sm text-gray-400 space-y-1">
                  <p>• 青い点をドラッグして拍の間隔を調整（最初の拍以外すべて動かせます）</p>
                  <p>• 間隔が狭い = 速い（accel）、広い = 遅い（rit）</p>
                  <p>• 最後の拍を大きく右に動かすと効果的なritが表現できます</p>
                  <p>• 緑の線は各パターンの1拍目</p>
                </div>
              </div>
            )}
          </div>

          {/* プリセット保存 */}
          <div className="bg-gray-800 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <Save size={20} className="mr-2 text-green-400" />
              <h2 className="text-xl font-semibold">プリセット保存</h2>
              <span className="ml-2 text-xs bg-blue-600 px-2 py-1 rounded">パターン設定 + テンポカーブ</span>
            </div>
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
                保存
              </button>
            </div>
            {saveError && (
              <p className="text-red-400 text-sm mt-2">{saveError}</p>
            )}
          </div>
        </div>

        {/* プリセット一覧 */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">プリセット一覧</h2>
            <button
              onClick={() => setShowImportModal(true)}
              className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded flex items-center text-sm"
            >
              <Upload size={16} className="mr-2" />
              インポート
            </button>
          </div>
          
          {savedPresets.length === 0 ? (
            <p className="text-gray-400 text-center py-8">
              保存されたプリセットはありません
            </p>
          ) : (
            <div className="space-y-2">
              {savedPresets.map((preset) => (
                <div key={preset.id} className="bg-gray-700 p-3 rounded flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold flex items-center">
                      {preset.name}
                      {preset.tempoCurve?.enabled && (
                        <span className="ml-2 text-xs bg-purple-600 px-2 py-1 rounded">カーブ</span>
                      )}
                    </h3>
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
                      onClick={() => sharePresetFunction(preset)}
                      className="bg-purple-600 hover:bg-purple-700 p-1 rounded"
                      title="共有"
                    >
                      <Share2 size={16} />
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