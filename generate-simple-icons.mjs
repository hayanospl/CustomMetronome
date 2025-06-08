import fs from 'fs';
import path from 'path';

// SVGアイコンのテンプレート
const createSVGIcon = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景円 -->
  <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 5}" fill="#3b82f6"/>
  
  <!-- メトロノームの基台 -->
  <rect x="${size*0.2}" y="${size*0.8}" width="${size*0.6}" height="${size*0.15}" fill="#1f2937" rx="4"/>
  
  <!-- メトロノームの本体（三角形） -->
  <path d="M ${size/2} ${size*0.2} L ${size*0.25} ${size*0.8} L ${size*0.75} ${size*0.8} Z" fill="#374151"/>
  
  <!-- 振り子 -->
  <line x1="${size/2}" y1="${size*0.25}" x2="${size*0.65}" y2="${size*0.65}" stroke="#fbbf24" stroke-width="${size*0.02}"/>
  
  <!-- 振り子の重り -->
  <circle cx="${size*0.65}" cy="${size*0.65}" r="${size*0.05}" fill="#f59e0b"/>
  
  <!-- 音符マーク -->
  <text x="${size*0.4}" y="${size*0.5}" font-family="Arial" font-size="${size*0.15}" fill="white" font-weight="bold">♪</text>
  
  <!-- リズムの波線 -->
  <path d="M ${size*0.15} ${size*0.3} Q ${size*0.25} ${size*0.28} ${size*0.35} ${size*0.3} Q ${size*0.45} ${size*0.32} ${size*0.55} ${size*0.3}" 
        stroke="#60a5fa" stroke-width="${size*0.01}" fill="none"/>
  <path d="M ${size*0.15} ${size*0.38} Q ${size*0.25} ${size*0.36} ${size*0.35} ${size*0.38} Q ${size*0.45} ${size*0.4} ${size*0.55} ${size*0.38}" 
        stroke="#60a5fa" stroke-width="${size*0.01}" fill="none"/>
  <path d="M ${size*0.15} ${size*0.46} Q ${size*0.25} ${size*0.44} ${size*0.35} ${size*0.46} Q ${size*0.45} ${size*0.48} ${size*0.55} ${size*0.46}" 
        stroke="#60a5fa" stroke-width="${size*0.01}" fill="none"/>
</svg>`;

// 必要なサイズ
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// publicディレクトリが存在しない場合は作成
if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
}

// 各サイズのSVGアイコンを生成
sizes.forEach(size => {
  const svgContent = createSVGIcon(size);
  const filename = `public/icon-${size}.svg`;
  fs.writeFileSync(filename, svgContent);
  console.log(`✓ Generated ${filename}`);
});

// favicon.ico用の小さいアイコンも生成
const faviconSVG = createSVGIcon(32);
fs.writeFileSync('public/favicon.svg', faviconSVG);
console.log('✓ Generated public/favicon.svg');

// faviconの代替としてicoファイルも生成（簡易版）
fs.writeFileSync('public/favicon.ico', faviconSVG);
console.log('✓ Generated public/favicon.ico (as SVG)');

console.log('\n🎵 アイコン生成完了！');
console.log('注意: SVGファイルを生成しました。本格的なPWAではPNGファイルが推奨されます。');
console.log('オンラインツール（https://cloudconvert.com/svg-to-png）でPNGに変換してください。'); 