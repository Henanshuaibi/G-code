export const defaultAppearance=Object.freeze({version:1,mode:'light',background:'#ffffff',foreground:'#111111',accent:'#111111',fontSize:15,radius:12});
const color=value=>{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('颜色请填写完整的 HEX 值，例如 #ffffff');return value.toLowerCase();};
const rgb=value=>[1,3,5].map(index=>parseInt(value.slice(index,index+2),16));
const mix=(a,b,amount)=>'#'+rgb(a).map((value,index)=>Math.round(value*(1-amount)+rgb(b)[index]*amount).toString(16).padStart(2,'0')).join('');
export function luminance(value){const c=rgb(value).map(value=>{const n=value/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;}
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
export function appearance(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('外观设置格式不正确');
  const mode=input.mode??'light';if(!['light','dark','system','custom'].includes(mode))throw new Error('请选择有效的外观模式');
  const fontSize=Number(input.fontSize??15),radius=Number(input.radius??12);if(!Number.isInteger(fontSize)||fontSize<12||fontSize>22||!Number.isInteger(radius)||radius<0||radius>24)throw new Error('字号应为 12～22，圆角应为 0～24');
  const pick=(value,fallback)=>mode==='custom'?color(value??fallback):/^#[0-9a-f]{6}$/i.test(value??'')?color(value):fallback;
  const settings={version:1,mode,background:pick(input.background,'#ffffff'),foreground:pick(input.foreground,'#111111'),accent:pick(input.accent,'#111111'),fontSize,radius};
  if(mode==='custom'&&contrast(settings.background,settings.foreground)<3)throw new Error('文字与背景太接近，请换一组更容易看清的颜色');return settings;
}
export function loadAppearance(serialized){try{return appearance(JSON.parse(serialized||'{}'));}catch{return appearance();}}
export function themeFor(input,systemDark=false){
  const settings=appearance(input);const darkMode=settings.mode==='dark'||settings.mode==='system'&&systemDark;
  const bg=settings.mode==='custom'?settings.background:darkMode?'#171717':'#ffffff';const ink=settings.mode==='custom'?settings.foreground:darkMode?'#f4f4f4':'#111111';const accent=settings.mode==='custom'?settings.accent:ink;const dark=luminance(bg)<0.179;const danger=dark?'#ffb4ac':'#b42318';
  const readable=value=>contrast(value,'#111111')>=contrast(value,'#ffffff')?'#111111':'#ffffff';
  return {settings,dark,background:bg,foreground:ink,tokens:{'--bg':bg,'--ink':ink,'--panel':mix(bg,ink,.035),'--line':mix(bg,ink,.16),'--muted':mix(bg,ink,.65),'--accent':accent,'--on-accent':readable(accent),'--accent-text':contrast(accent,bg)>=3?accent:ink,'--danger':danger,'--on-danger':readable(danger),'--pressed':mix(bg,ink,.09),'--user':mix(bg,ink,.045),'--code':mix(bg,ink,.025),'--card':mix(bg,ink,.018),'--drawer':bg,'--sheet':bg,'--selected':mix(bg,ink,.085),'--toast-bg':ink,'--toast-ink':bg,'--phone-bg':mix(bg,danger,.085),'--phone-ink':ink,'--diff-add':dark?'#a9c79a':'#176b2b','--diff-del':danger,'--font-size':settings.fontSize+'px','--radius':settings.radius+'px'}};
}
export function applyAppearance(settings,systemDark,document,native){const theme=themeFor(settings,systemDark);const root=document.documentElement;for(const [key,value] of Object.entries(theme.tokens))root.style.setProperty(key,value);root.style.colorScheme=theme.dark?'dark':'light';root.dataset.appearance=settings.mode;native?.themeWindow(theme.background,theme.foreground);return theme;}
