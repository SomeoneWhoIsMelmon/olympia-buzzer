const socket = io();
const $ = id => document.getElementById(id);
const views = ['home','hostSetup','playerSetup','hostView','hostDatabase','playerView','projectorView'];
let role = null, roomCode = null, myId = null, myTeam = null, latest = null, hostLink = null, lastStatus = null, audioCtx = null, projectorMasterGain = null, projectorVolume = 1, tickHandle = null, independentTickHandle = setInterval(updateIndependentTimer, 100), projectorAudioQueue = [], projectorAudioBuffers = new Map(), projectorAudioReady = false, projectorAudioLoading = new Map(), projectorAudioResumePending = false, projectorOpeningMusicSource = null, projectorOpeningMusicKey = null, projectorOpeningMusicGeneration = 0, databaseQuestions = [], speedQuestionSlots = Array.from({length:4},()=>({prompt:'',media:null})), obstacleCourse = {rows:Array.from({length:4},()=>({answer:'',question:''})),keyword:'',fullAnswer:'',media:null}, speedMediaObjectUrls = Array(4).fill(null), speedMediaLoadVersions = Array(4).fill(0), obstacleMediaObjectUrl = null, activeRoundMediaObjectUrl = null, activeRoundMedia = null, activeRoundMediaVersion = 0, videoPlaybackRequestId = 0, pendingSpeedVideoPlayback = false, openingCorrectStreak = 0, openingStreakPlayerId = '', openingScorePending = false, activeSpeedQuestionSlot = null;
let finishRounds = Array.from({length:4},()=>Array.from({length:7},()=>({question:'',answer:''})));
let obstacleMediaLoadVersion = 0;
function show(id){ views.forEach(v => $(v).classList.toggle('hidden',v!==id)); document.body.classList.toggle('player-active',id==='playerView'); document.body.classList.toggle('host-active',id==='hostView'||id==='hostDatabase'); document.body.classList.toggle('database-page-active',id==='hostDatabase'); document.body.classList.toggle('projector-active',id==='projectorView'); }
function toast(msg){ $('toast').textContent=msg; $('toast').classList.remove('hidden'); setTimeout(()=>$('toast').classList.add('hidden'),2600); }
function canPlayerBuzz(){if(role!=='player'||!latest||latest.status!=='playing'||latest.buzzerCountdownDeadline||!latest.deadline||Date.now()>=latest.deadline)return false;const me=latest.players.find(player=>player.id===myId);return latest.buzzerAlwaysOpen?!Boolean(me&&me.buzzedAt):!latest.winnerId;}
function sound(type){ try { audioCtx ||= new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.connect(g);g.connect(audioCtx.destination);o.type='sine';o.frequency.value=type==='buzz'?880:type==='win'?660:440;g.gain.setValueAtTime(.001,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.18,audioCtx.currentTime+.015);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+(type==='win'?.45:.18));o.start();o.stop(audioCtx.currentTime+(type==='win'?.48:.2)); }catch(e){} }
function setProjectorVolume(volume){if(!Number.isFinite(volume))return;projectorVolume=Math.max(0,Math.min(1,volume));if(projectorMasterGain){projectorMasterGain.gain.setTargetAtTime(projectorVolume,audioCtx.currentTime,.02);}if(role==='host'&&$('projectorVolume')){$('projectorVolume').value=String(Math.round(projectorVolume*100));$('projectorVolumeValue').value=`${Math.round(projectorVolume*100)}%`;}}
function getProjectorOutput(){if(!projectorMasterGain){projectorMasterGain=audioCtx.createGain();projectorMasterGain.gain.value=projectorVolume;projectorMasterGain.connect(audioCtx.destination);}return projectorMasterGain;}
async function loadProjectorAudio(type){if(projectorAudioBuffers.has(type))return projectorAudioBuffers.get(type);if(projectorAudioLoading.has(type))return projectorAudioLoading.get(type);const loading=(async()=>{const context=audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());const files={buzz:'Buzz.mp3',correct:'Correct.mp3',wrong:'Wrong.mp3',start:'StartKD.mp3',end:'EndKD.mp3',opening:'KD60s.mp3',musicA:'KDmusicA.mp3',musicB:'KDmusicB.mp3',musicC:'KDmusicC.mp3',blank:'Blank.ogg',vcnv15:'VCNV15s.mp3',tt20:'TT20s.mp3',tt30:'TT30s.mp3',tt40:'TT40s.mp3',speedQuestionOpen:'OpenQsTT.mp3',showAnswerVCNV:'ShowAnsVCNV.ogg',showAnswerTT:'ShowAnsTT.ogg'};const file=files[type];if(!file)throw new Error('Không tìm thấy tệp âm thanh.');const response=await fetch(`/Olympia%20Music/${encodeURIComponent(file)}`);if(!response.ok)throw new Error(`Không tải được ${file} (${response.status}).`);const buffer=await context.decodeAudioData(await response.arrayBuffer());projectorAudioBuffers.set(type,buffer);return buffer;})();projectorAudioLoading.set(type,loading);try{return await loading;}finally{projectorAudioLoading.delete(type);}}
function playNextProjectorAudio(){if(role!=='projector'||!projectorAudioReady||!projectorAudioQueue.length)return;const type=projectorAudioQueue[0],buffer=projectorAudioBuffers.get(type);if(!buffer)return;const context=audioCtx;if(context.state!=='running'){if(!projectorAudioResumePending){projectorAudioResumePending=true;context.resume().then(()=>{projectorAudioResumePending=false;playNextProjectorAudio();}).catch(error=>{projectorAudioResumePending=false;toast(`Không thể tiếp tục phát âm thanh: ${error.message}`);});}return;}projectorAudioQueue.shift();const source=context.createBufferSource();source.buffer=buffer;source.connect(getProjectorOutput());source.onended=playNextProjectorAudio;source.start();}
async function queueProjectorAudio(type){if(!['buzz','correct','wrong','start','end','opening','blank','vcnv15','tt20','tt30','tt40','speedQuestionOpen','showAnswerVCNV','showAnswerTT'].includes(type))return;projectorAudioQueue.push(type);if(!projectorAudioBuffers.has(type)){try{await loadProjectorAudio(type);}catch(error){projectorAudioQueue=projectorAudioQueue.filter(item=>item!==type);toast(`Không thể tải âm thanh máy chiếu: ${error.message}`);return;}}playNextProjectorAudio();}
function queueProjectorBuzz(){queueProjectorAudio('buzz');}
function syncProjectorOpeningMusic(state,force=false){
 if(role!=='projector')return;
 let desired=null;
 if(state?.openingQuestionMode==='o27'&&Number.isInteger(state.openingQuestionIndex)&&Number.isInteger(state.openingEmptyQuestionNumber)){
  const questionNumber=state.openingQuestionIndex+1;
  const emptyNumber=state.openingEmptyQuestionNumber;
  const midpoint=Math.floor(emptyNumber/2);
  if(questionNumber>=1&&questionNumber<=midpoint)desired='musicA';
  else if(questionNumber===emptyNumber-1)desired='musicC';
  else if(questionNumber>=midpoint+1&&questionNumber<=emptyNumber-2)desired='musicB';
 }
 if(!force&&desired===projectorOpeningMusicKey)return;
 projectorOpeningMusicKey=desired;
 const generation=++projectorOpeningMusicGeneration;
 if(projectorOpeningMusicSource){const source=projectorOpeningMusicSource;projectorOpeningMusicSource=null;source.stop();source.disconnect();}
 if(!desired||!projectorAudioReady)return;
 loadProjectorAudio(desired).then(buffer=>{
  if(generation!==projectorOpeningMusicGeneration||desired!==projectorOpeningMusicKey||!projectorAudioReady)return;
  if(audioCtx.state!=='running')return audioCtx.resume().then(()=>{if(generation===projectorOpeningMusicGeneration)startProjectorOpeningMusic(desired,buffer);}).catch(error=>toast(`Không thể tiếp tục nhạc Khởi động: ${error.message}`));
  startProjectorOpeningMusic(desired,buffer);
 }).catch(error=>{
  if(generation===projectorOpeningMusicGeneration)toast(`Không thể tải nhạc Khởi động: ${error.message}`);
 });
}
function startProjectorOpeningMusic(type,buffer){
 if(role!=='projector'||!projectorAudioReady||projectorOpeningMusicKey!==type)return;
 const source=audioCtx.createBufferSource();
 source.buffer=buffer;
 source.loop=type==='musicA'||type==='musicB';
 source.connect(getProjectorOutput());
 source.onended=()=>{if(projectorOpeningMusicSource===source)projectorOpeningMusicSource=null;};
 projectorOpeningMusicSource=source;
 source.start();
}
async function unlockProjectorAudio(){if(role!=='projector')return;try{const context=audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());await context.resume();await Promise.all(['buzz','correct','wrong','start','end','opening','vcnv15','tt20','tt30','tt40','speedQuestionOpen','showAnswerVCNV','showAnswerTT'].map(loadProjectorAudio));projectorAudioReady=true;playNextProjectorAudio();syncProjectorOpeningMusic(latest,true);toast('Âm thanh máy chiếu đã bật.');}catch(error){projectorAudioReady=false;toast(`Không thể bật âm thanh máy chiếu: ${error.message}`);}}
function emitAck(event,data={}){return new Promise(resolve=>socket.emit(event,data,r=>resolve(r||{ok:false,error:'Không nhận được phản hồi từ máy chủ.'})));}
function reportPlayerFocus(){if(role==='player'&&socket.connected)socket.emit('player:focus',{focused:document.visibilityState==='visible'&&document.hasFocus()});}
window.addEventListener('focus',reportPlayerFocus);
window.addEventListener('blur',reportPlayerFocus);
document.addEventListener('visibilitychange',reportPlayerFocus);
document.addEventListener('keydown',event=>{
 if(role!=='host'||$('hostView').classList.contains('hidden')||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
 if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
 const buttons={ArrowUp:$('openingAnswerCorrect'),ArrowDown:$('openingAnswerIncorrect'),ArrowRight:$('nextOpeningQuestion'),ArrowLeft:$('previousOpeningQuestion'),z:$('startFiveSecondTimer'),Z:$('startFiveSecondTimer'),b:$('playBlankSound'),B:$('playBlankSound')};
 const button=buttons[event.key];
 if(!button)return;
 event.preventDefault();
 if(!button.disabled)button.click();
});
$('goHost').onclick=()=>show('hostSetup'); $('goPlayer').onclick=()=>show('playerSetup'); document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show('home'));
$('createRoom').onclick=async()=>{const teams=$('teams').value.split('\n').map(x=>x.trim()).filter(Boolean);const r=await emitAck('host:create',{hostName:$('hostName').value,duration:$('duration').value,teams});if(!r.ok)return toast(r.error);role='host';roomCode=r.code;hostLink=`${location.origin}/?room=${roomCode}`;$('hostCode').textContent=roomCode;show('hostView');render(r.state);renderAnswers([]);await loadDatabase();};
$('hostView').querySelectorAll('[data-host-round]').forEach(button=>button.addEventListener('click',async()=>{
 const data={round:button.dataset.hostRound};
 activeSpeedQuestionSlot=null;
 const result=await emitAck('host:round-mode',data);
 if(!result.ok)toast(result.error);
 else updateHostRoundButtons(data.round);
}));
function updateHostRoundButtons(round){
 $('hostView').querySelectorAll('[data-host-round]').forEach(button=>{
  const active=button.dataset.hostRound===round;
  button.classList.toggle('is-active',active);
  button.setAttribute('aria-pressed',String(active));
 });
 $('hostView').querySelector('.opening-question-layout').classList.toggle('hidden',round!=='opening');
}
function renderSpeedQuestionSelect(){
 const select=$('speedQuestionSelect');
 const selected=select.value;
 const options=[['','Chọn câu tăng tốc']];
 speedQuestionSlots.forEach((slot,index)=>{
  if(slot.media)options.push([String(index),`Tăng tốc ${index+1}${slot.prompt?`: ${slot.prompt}`:''}`]);
 });
 select.replaceChildren(...options.map(([value,label])=>{
  const option=document.createElement('option');option.value=value;option.textContent=label;return option;
 }));
 select.value=options.some(([value])=>value===selected)?selected:'';
}
$('speedQuestionSelect').addEventListener('change',async()=>{
 activeSpeedQuestionSlot=null;
 $('hostAnswerNote').value='';
 if(latest?.roundMode!=='speed')return;
 const result=await emitAck('host:round-mode',{round:'speed'});
 if(!result.ok)toast(result.error);
});
$('openProjector').onclick=()=>{const projector=window.open(`${location.origin}/?projector=${encodeURIComponent(roomCode)}`,'_blank');if(!projector)toast('Trình duyệt đã chặn cửa sổ máy chiếu. Hãy cho phép cửa sổ bật lên rồi thử lại.');};
$('openDatabase').onclick=()=>{
 const databasePage=window.open('about:blank','_blank');
 if(!databasePage)return toast('Trình duyệt đã chặn cửa sổ Database. Hãy cho phép cửa sổ bật lên rồi thử lại.');
 emitAck('host:database:token').then(result=>{
  if(!result.ok){databasePage.close();return toast(result.error);}
  databasePage.location.href=`${location.origin}/?database=${encodeURIComponent(roomCode)}#${result.token}`;
 }).catch(error=>{databasePage.close();toast(`Không thể mở Database: ${error.message}`);});
};
$('closeDatabase').onclick=()=>{if(role==='database')window.close();else show('hostView');};
$('clearDatabase').onclick=async()=>{
 if(!databaseQuestions.length)return;
 if(!confirm(`Xóa toàn bộ ${databaseQuestions.length} câu hỏi khỏi Database của phòng này?`))return;
 $('clearDatabase').disabled=true;
 const result=await emitAck('host:database:clear');
 if(!result.ok){$('clearDatabase').disabled=false;return toast(result.error);}
 databaseQuestions=result.questions;
 renderDatabase();
 refreshSpotlightControls(latest);
 syncHostOpeningAnswer(latest);
 toast(`Đã xóa ${result.deleted} câu hỏi khỏi Database.`);
};
$('importWorkbook').onclick=async()=>{
 const file=$('databaseFile').files[0];
 if(!file)return toast('Hãy chọn file Excel .xlsx trước.');
 try{
  const workbookData=await window.parseOlympiaWorkbook(file);
  const questionCount=workbookData.questions.length,speedCount=workbookData.speedQuestions?.filter(item=>item.prompt||item.answer).length||0;
  const speedAction=workbookData.speedQuestions?'cập nhật 4 ô Tăng tốc':'giữ nguyên 4 ô Tăng tốc (không có sheet “Tăng tốc B”)';
  const obstacleCount=workbookData.obstacleCourse?.rows.filter(item=>item.answer||item.question).length||0;
  const obstacleAction=workbookData.obstacleCourse?'cập nhật bảng Vượt chướng ngại vật':'giữ nguyên bảng Vượt chướng ngại vật (không có sheet “VCNV”)';
  const finishCount=workbookData.finishRounds?.flat().filter(item=>item.question||item.answer).length||0;
  const finishAction=workbookData.finishSheetIncluded?`cập nhật 4 bảng Về đích (${finishCount} dòng có nội dung)`:'giữ nguyên 4 bảng Về đích (không có sheet “Về đích”)';
  const openingAction=workbookData.openingSheetIncluded?'thay thế toàn bộ câu hỏi trong 5 bảng Khởi Động':'giữ nguyên 5 bảng Khởi Động (không có sheet “Khởi động”)';
  if(!confirm(`Tìm thấy ${questionCount} câu Khởi Động, ${speedCount} câu Tăng tốc, ${obstacleCount} hàng ngang Vượt chướng ngại vật và ${finishCount} dòng Về đích. ${openingAction}, ${speedAction}, ${obstacleAction}, ${finishAction}?`))return;
  const result=await emitAck('host:database:import-document',workbookData);
  if(!result.ok)return toast(result.error);
  databaseQuestions=result.questions;
  if(result.speedQuestions){speedQuestionSlots=result.speedQuestions;renderSpeedQuestionSlots();}
  if(result.obstacleCourse){obstacleCourse=result.obstacleCourse;renderObstacleCourse();}
  if(result.finishRounds){finishRounds=result.finishRounds;renderFinishRounds();}
  renderSpeedQuestionSelect();
  renderDatabase();refreshSpotlightControls(latest);syncHostOpeningAnswer(latest);
  $('databaseFile').value='';
  const openingResult=workbookData.openingSheetIncluded?`đã thay thế bằng ${result.imported} câu Khởi Động`:'đã giữ nguyên 5 bảng Khởi Động';
  toast(`${openingResult}; ${workbookData.speedQuestions?'đã cập nhật 4 câu Tăng tốc':'giữ nguyên câu Tăng tốc'}; ${workbookData.obstacleCourse?'đã cập nhật bảng Vượt chướng ngại vật':'giữ nguyên bảng Vượt chướng ngại vật'}; ${workbookData.finishSheetIncluded?'đã cập nhật 4 bảng Về đích.':'giữ nguyên 4 bảng Về đích.'}`);
 }catch(error){toast(`Không thể nhập file Excel: ${error.message}`);}
};
$('speedQuestionSlots').querySelectorAll('.database-speed-card').forEach(card=>{
 const slot=Number(card.dataset.speedSlot),prompt=card.querySelector('.database-speed-prompt'),answer=card.querySelector('.database-speed-answer'),button=card.querySelector('.database-speed-media-button'),fileInput=card.querySelector('.database-speed-file');
 const saveTextField=async(field,input)=>{
  const result=await emitAck('host:database:speed-question:update',{slot,[field]:input.value});
  if(!result.ok){toast(result.error);input.value=speedQuestionSlots[slot][field];}
  else speedQuestionSlots[slot][field]=input.value;
 };
 prompt.addEventListener('change',()=>saveTextField('prompt',prompt));
 answer.addEventListener('change',()=>saveTextField('answer',answer));
 button.addEventListener('click',async()=>{
  if(speedQuestionSlots[slot].media){
   button.disabled=true;
   const result=await emitAck('host:database:speed-media:delete',{slot});
   button.disabled=false;
   if(!result.ok)return toast(result.error);
   speedMediaLoadVersions[slot]++;
   speedQuestionSlots[slot].media=null;
   renderSpeedMediaPreview(slot);
   toast(`Đã xóa media Tăng tốc ${slot+1}.`);
   return;
  }
  fileInput.click();
 });
 fileInput.addEventListener('change',async()=>{
  const file=fileInput.files[0];
  if(!file)return;
  if(file.size>10*1024*1024){fileInput.value='';return toast('File media không được vượt quá 10 MB.');}
  if(!/^(image|video)\//i.test(file.type)){fileInput.value='';return toast('Chỉ hỗ trợ file ảnh hoặc video.');}
  button.disabled=true;
  try{
   const result=await emitAck('host:database:speed-media:set',{slot,name:file.name,type:file.type,data:await file.arrayBuffer()});
   if(!result.ok)return toast(result.error);
   speedMediaLoadVersions[slot]++;
   speedQuestionSlots[slot].media=result.media;
   renderSpeedMediaPreview(slot,file);
  }catch(error){toast(`Không thể tải media lên: ${error.message}`);}
  finally{button.disabled=false;fileInput.value='';}
 });
});
$('obstacleMediaButton').addEventListener('click',async()=>{
 if(obstacleCourse.media){
  $('obstacleMediaButton').disabled=true;
  const result=await emitAck('host:database:obstacle-media:delete');
  $('obstacleMediaButton').disabled=false;
  if(!result.ok)return toast(result.error);
  obstacleCourse.media=null;
  renderObstacleCourseMedia();
  return;
 }
 $('obstacleMediaFile').click();
});
$('obstacleMediaFile').addEventListener('change',async()=>{
 const file=$('obstacleMediaFile').files[0];
 if(!file)return;
 if(file.size>10*1024*1024){$('obstacleMediaFile').value='';return toast('File media không được vượt quá 10 MB.');}
 if(!/^(image|video)\//i.test(file.type)){$('obstacleMediaFile').value='';return toast('Chỉ hỗ trợ file ảnh hoặc video.');}
 $('obstacleMediaButton').disabled=true;
 try{
  const result=await emitAck('host:database:obstacle-media:set',{name:file.name,type:file.type,data:await file.arrayBuffer()});
  if(!result.ok)return toast(result.error);
  obstacleCourse.media=result.media;
  renderObstacleCourseMedia(file);
 }catch(error){toast(`Không thể tải media VCNV lên: ${error.message}`);}
 finally{$('obstacleMediaButton').disabled=false;$('obstacleMediaFile').value='';}
});
$('databaseObstacleCourse').querySelectorAll('[data-obstacle-row]').forEach(rowElement=>{
 const rowIndex=Number(rowElement.dataset.obstacleRow),cells=rowElement.querySelector('.obstacle-answer-grid');
 for(let cellIndex=0;cellIndex<16;cellIndex++){
  const input=document.createElement('input');
  input.type='text';input.maxLength=4;input.autocomplete='off';input.setAttribute('aria-label',`Đáp án hàng ngang ${rowIndex+1}, ô ${cellIndex+1}`);
  input.addEventListener('input',()=>{
   const graphemes=splitGraphemes(input.value);
   if(graphemes.length>1){
    cells.querySelectorAll('input').forEach((cell,index)=>{cell.value=graphemes[index]||'';});
   }
   updateObstacleLetterCount(rowElement);
  });
  input.addEventListener('keydown',event=>{
   if(event.key==='Backspace'&&!input.value&&cellIndex>0){cells.querySelectorAll('input')[cellIndex-1].focus();}
   else if(event.key.length===1&&cellIndex<15&&!event.ctrlKey&&!event.metaKey&&!event.altKey){setTimeout(()=>{if(input.value)cells.querySelectorAll('input')[cellIndex+1].focus();},0);}
  });
  input.addEventListener('change',()=>saveObstacleCourse({row:rowIndex,answer:readObstacleAnswer(rowElement)}));
  cells.append(input);
 }
 rowElement.querySelector('.obstacle-question').addEventListener('change',event=>saveObstacleCourse({row:rowIndex,question:event.currentTarget.value}));
});
$('databaseObstacleCourse').querySelector('.obstacle-keyword').addEventListener('change',event=>{
 updateObstacleKeywordCount();
 saveObstacleCourse({keyword:event.currentTarget.value});
});
$('databaseObstacleCourse').querySelector('.obstacle-keyword-question').addEventListener('change',event=>saveObstacleCourse({keywordQuestion:event.currentTarget.value}));
$('databaseObstacleCourse').querySelector('.obstacle-full-answer').addEventListener('input',updateObstacleFullAnswerCount);
$('databaseObstacleCourse').querySelector('.obstacle-full-answer').addEventListener('change',event=>saveObstacleCourse({fullAnswer:event.currentTarget.value}));
$('spotlightRound').addEventListener('change',saveSpotlightSelection);
$('spotlightPlayer').addEventListener('change',saveSpotlightSelection);
$('spotlightPlayer').addEventListener('change',()=>{
 openingStreakPlayerId=$('spotlightPlayer').value;
 openingCorrectStreak=0;
});
$('openingStreakBonus').addEventListener('change',()=>{
 if(!$('openingStreakBonus').checked)openingCorrectStreak=0;
});
$('openingAnswerCorrect').onclick=async()=>{
 const playerId=$('spotlightPlayer').value;
 if(!playerId)return toast('Hãy chọn thí sinh trước.');
 if(openingScorePending)return;
 if(openingStreakPlayerId!==playerId){openingStreakPlayerId=playerId;openingCorrectStreak=0;}
 const nextStreak=$('openingStreakBonus').checked?openingCorrectStreak+1:0;
 const bonus=nextStreak===5?20:0;
 openingScorePending=true;
 $('openingAnswerCorrect').disabled=true;
 const commonRound=latest?.openingStartArmed&&latest.openingQuestionRound==='Lượt chung';
 const saved=await emitAck('host:opening:judge',{playerId,result:'correct',points:commonRound?10:10+bonus});
 openingScorePending=false;
 $('openingAnswerCorrect').disabled=!$('spotlightPlayer').value;
 if(!saved.ok)return toast(saved.error);
 openingCorrectStreak=commonRound||bonus?0:nextStreak;
 if(bonus&&!commonRound)toast('Đúng 5 lần liên tiếp! Đã cộng thêm 20 điểm thưởng.');
};
$('openingAnswerIncorrect').onclick=async()=>{
 const playerId=$('spotlightPlayer').value;
 if(!playerId)return toast('Hãy chọn thí sinh trước.');
 const player=latest?.players.find(item=>item.id===playerId);
 if(!player)return toast('Không tìm thấy thí sinh đã chọn.');
 const result=await emitAck('host:opening:judge',{playerId,result:'wrong'});
 if(!result.ok)return toast(result.error);
 openingCorrectStreak=0;
 const commonRound=latest?.openingStartArmed&&latest.openingQuestionRound==='Lượt chung';
 toast(commonRound?`${player.name}: câu trả lời sai, bị trừ 5 điểm.`:`${player.name}: câu trả lời sai, không bị trừ điểm.`);
};
$('openingStartSound').onclick=async()=>{const result=await emitAck('host:opening:audio',{type:'start'});if(!result.ok)toast(result.error);};
$('openingEndSound').onclick=async()=>{
 activeSpeedQuestionSlot=null;
 const result=await emitAck('host:opening:audio',{type:'end'});
 if(!result.ok)return toast(result.error);
 $('hostQuestionInput').value='';
 $('hostAnswerNote').value='';
 setOpeningNavigationEnabled(false);
 $('spotlightPlayer').value='';
 openingStreakPlayerId='';
 openingCorrectStreak=0;
 await saveSpotlightSelection();
};
async function startOpeningRound(mode){
 activeSpeedQuestionSlot=null;
 const round=$('spotlightRound').value;
 if(!round)return toast('Hãy chọn lượt thi Khởi động trước.');
 const result=await emitAck('host:opening:start',{round,mode,duration:$('duration').value});
 if(!result.ok)return toast(result.error);
 $('hostAnswerNote').value=result.answer||'';
 setOpeningNavigationEnabled(true);
 if(mode==='standard'){const audioResult=await emitAck('host:opening:audio',{type:'opening'});if(!audioResult.ok)toast(audioResult.error);}
}
$('startOpeningQuestions').onclick=()=>startOpeningRound('standard');
$('startOpeningO27').onclick=()=>startOpeningRound('o27');
$('startFiveSecondTimer').onclick=async()=>{const result=await emitAck('host:opening:timer');if(!result.ok)toast(result.error);};
$('playBlankSound').onclick=async()=>{const result=await emitAck('host:opening:audio',{type:'blank'});if(!result.ok)toast(result.error);};
$('nextOpeningQuestion').onclick=()=>navigateOpeningQuestion('next');
$('previousOpeningQuestion').onclick=()=>navigateOpeningQuestion('previous');
async function navigateOpeningQuestion(direction){
 const result=await emitAck('host:opening:navigate',{round:$('spotlightRound').value,direction,duration:$('duration').value});
 if(!result.ok)return toast(result.error);
 $('hostAnswerNote').value=result.answer||'';
}
$('projectorFullscreen').onclick=async()=>{unlockProjectorAudio();try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(e){toast('Không thể bật toàn màn hình trên trình duyệt này.');}};
$('hostQuestionInput').addEventListener('keydown',async e=>{if(e.key!=='Enter'||e.shiftKey||e.isComposing)return;e.preventDefault();activeSpeedQuestionSlot=null;$('hostAnswerNote').value='';const r=await emitAck('host:question',{question:$('hostQuestionInput').value,resetBuzzer:true});if(!r.ok)toast(r.error);});
$('openSpeedQuestion').onclick=async()=>{
 const selectedSlot=$('speedQuestionSelect').value;
 if(selectedSlot==='')return toast('Hãy chọn câu Tăng tốc có media.');
 const slotIndex=Number(selectedSlot),slot=speedQuestionSlots[slotIndex];
 if(!Number.isInteger(slotIndex)||!slot?.media)return toast('Hãy chọn câu Tăng tốc có media.');
 if(!slot.prompt?.trim())return toast(`Câu Tăng tốc ${slotIndex+1} chưa có nội dung câu hỏi.`);
 activeSpeedQuestionSlot=slotIndex;
 $('hostQuestionInput').value=slot.prompt;
 $('hostAnswerNote').value=slot.answer||'';
 const roundResult=await emitAck('host:round-mode',{round:'speed',speedSlot:slotIndex,openMedia:true});
 if(!roundResult.ok){activeSpeedQuestionSlot=null;$('hostAnswerNote').value='';return toast(roundResult.error);}
 const questionResult=await emitAck('host:question',{question:slot.prompt,resetBuzzer:true});
 if(!questionResult.ok){activeSpeedQuestionSlot=null;$('hostAnswerNote').value='';return toast(questionResult.error);}
 const audioResult=await emitAck('host:opening:audio',{type:'speedQuestionOpen'});
 if(!audioResult.ok)toast(audioResult.error);
};
$('joinCode').addEventListener('input',async()=>{const code=$('joinCode').value.trim().toUpperCase();if(code.length<6)return;const r=await emitAck('room:peek',{code});if(r.ok)fillTeams(r.teams);});
// Team list is sent by the server through a lightweight public lookup event.
socket.on('room:teams',({teams})=>fillTeams(teams));
function fillTeams(teams){$('playerTeam').innerHTML='';(teams||['Đội 1','Đội 2']).forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;$('playerTeam').append(o);});}
$('joinRoom').onclick=async()=>{const r=await emitAck('player:join',{code:$('joinCode').value,name:$('playerName').value,team:$('playerTeam').value});if(!r.ok)return toast(r.error);role='player';roomCode=r.state.code;myId=r.playerId;myTeam=$('playerTeam').value;$('playerRoomCode').textContent=roomCode;$('myTeam').textContent=myTeam;show('playerView');render(r.state);reportPlayerFocus();};
$('startRound').onclick=async()=>{const r=await emitAck('host:start',{duration:$('duration').value});if(!r.ok)toast(r.error);};
$('startRoundDelayed').onclick=async()=>{const r=await emitAck('host:start:delayed',{duration:$('duration').value});if(!r.ok)toast(r.error);};
$('lockRound').onclick=async()=>{const r=await emitAck('host:lock');if(!r.ok)toast(r.error);};$('resetRound').onclick=async()=>{const r=await emitAck('host:reset');if(!r.ok)toast(r.error);};
$('alwaysOpen').addEventListener('change',async()=>{const r=await emitAck('host:buzzer-mode',{alwaysOpen:$('alwaysOpen').checked});if(!r.ok){$('alwaysOpen').checked=!$('alwaysOpen').checked;toast(r.error);}});
$('independentStart').onclick=async()=>{let r;if(!latest?.independentTimer||Number($('independentDuration').value)!==latest.independentTimer.duration){r=await emitAck('host:independent:set',{duration:$('independentDuration').value});if(!r.ok)return toast(r.error);}r=await emitAck('host:independent:start');if(!r.ok)toast(r.error);};
$('hostView').querySelectorAll('[data-independent-seconds]').forEach(button=>button.addEventListener('click',async()=>{
 const seconds=Number(button.dataset.independentSeconds);
 $('independentDuration').value=String(seconds);
 const configured=await emitAck('host:independent:set',{duration:seconds});
 if(!configured.ok)return toast(configured.error);
 const started=await emitAck('host:independent:start');
 if(!started.ok)toast(started.error);
 else{
  const selectedSpeedSlot=Number($('speedQuestionSelect').value);
  if([20,30,40].includes(seconds)&&$('speedQuestionSelect').value!==''&&latest?.roundMode==='speed'&&Number.isInteger(selectedSpeedSlot)&&speedQuestionSlots[selectedSpeedSlot]?.media?.type.startsWith('video/')){
   const videoResult=await emitAck('host:speed-video:play',{seconds});
   if(!videoResult.ok)toast(videoResult.error);
  }
  const soundType={15:'vcnv15',20:'tt20',30:'tt30',40:'tt40'}[seconds];
  const soundResult=await emitAck('host:opening:audio',{type:soundType});
  if(!soundResult.ok)toast(soundResult.error);
 }
}));
$('independentPause').onclick=async()=>{const r=await emitAck('host:independent:pause');if(!r.ok)toast(r.error);};
$('independentReset').onclick=async()=>{const r=await emitAck('host:independent:reset');if(!r.ok)toast(r.error);};
$('revealLatestAnswers').onclick=async()=>{
 const button=$('revealLatestAnswers');
 if(button.dataset.projectorOpen==='true'){
  const result=await emitAck('host:answer:hide');
  if(!result.ok)return toast(result.error);
  button.dataset.projectorOpen='false';
  button.textContent='HIỆN ĐÁP ÁN';
  button.classList.remove('is-answer-reveal-open');
  return;
 }
 const soundType=latest?.roundMode==='obstacle'?'showAnswerVCNV':'showAnswerTT';
 const soundResult=await emitAck('host:opening:audio',{type:soundType});
 if(!soundResult.ok)return toast(soundResult.error);
 const result=await emitAck('host:answer:reveal');
 if(!result.ok)return toast(result.error);
 button.dataset.projectorOpen='true';
 button.textContent='ĐÓNG ĐÁP ÁN';
 button.classList.add('is-answer-reveal-open');
 toast(result.count?`Đã hiện đáp án mới nhất cho ${result.count} thí sinh.`:'Chưa có thí sinh gửi câu trả lời.');
};
$('closeAnswerReveal').onclick=()=>$('answerRevealDialog').close();
socket.on('player:answer:reveal',({answers}={})=>{if(!['player','projector'].includes(role)||!Array.isArray(answers))return;const list=$('revealedAnswers');list.replaceChildren();if(!answers.length){const empty=document.createElement('p');empty.className='revealed-answers-empty';empty.textContent='Chưa có thí sinh gửi câu trả lời.';list.append(empty);}else{answers.forEach(item=>{if(!item||typeof item.name!=='string'||typeof item.team!=='string'||typeof item.answer!=='string'||!Number.isFinite(item.elapsedMs))return;const entry=document.createElement('article');entry.className='revealed-answer';const heading=document.createElement('div');heading.className='revealed-answer-heading';const player=document.createElement('strong');player.textContent=`${item.name} · ${item.team}`;const time=document.createElement('time');time.textContent=formatElapsed(item.elapsedMs);heading.append(player,time);const answer=document.createElement('p');answer.textContent=item.answer;entry.append(heading,answer);list.append(entry);});} $('answerRevealDialog').showModal();});
socket.on('projector:answer:hide',()=>{if(role==='projector'&&$('answerRevealDialog').open)$('answerRevealDialog').close();});
$('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(hostLink);toast('Đã sao chép link tham gia.');}catch(e){toast(hostLink);}};
$('projectorVolume').addEventListener('input',()=>{
 const volume=Number($('projectorVolume').value)/100;
 setProjectorVolume(volume);
 socket.emit('host:projector:volume',{volume},result=>{
  if(result?.ok)return;
  toast(result?.error||'Không thể cập nhật âm lượng máy chiếu.');
  setProjectorVolume(latest?.projectorVolume??1);
 });
});
let buzzPointerId=null,buzzPointerEligible=false;
document.addEventListener('pointerdown',event=>{if(role!=='player')return;const rect=$('buzzButton').getBoundingClientRect();const inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;if(!inside)return;buzzPointerId=event.pointerId;buzzPointerEligible=canPlayerBuzz();},true);
document.addEventListener('pointerup',event=>{if(event.pointerId!==buzzPointerId)return;const rect=$('buzzButton').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){buzzPointerEligible=false;buzzPointerId=null;}},true);
document.addEventListener('pointercancel',event=>{if(event.pointerId===buzzPointerId){buzzPointerEligible=false;buzzPointerId=null;}},true);
$('buzzButton').onclick=async event=>{if(event.detail>0){const startedWhileOpen=buzzPointerEligible;buzzPointerEligible=false;buzzPointerId=null;if(!startedWhileOpen)return;}if(!canPlayerBuzz())return;const r=await emitAck('player:buzz');if(!r.ok)toast(r.error);};
$('answerForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('answerInput');const answer=input.value.trim();if(!answer)return toast('Bạn chưa nhập câu trả lời.');$('submitAnswer').disabled=true;const r=await emitAck('player:answer',{answer});$('submitAnswer').disabled=Boolean(input.disabled);if(!r.ok)return toast(r.error);if(input.value.trim()===answer)input.value='';$('lastAnswerText').textContent=answer;$('lastAnswerTime').textContent=`Đã gửi lúc ${formatElapsed(r.elapsedMs)}`;$('answerMessage').textContent=`Đã ghi nhận câu trả lời lúc ${formatElapsed(r.elapsedMs)}. Bạn có thể gửi tiếp.`;$('answerMessage').className='answer-confirm';if(!input.disabled)input.focus();});
$('answerInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('answerForm').requestSubmit();}});
function formatElapsed(ms){const m=Math.floor(ms/60000),s=Math.floor(ms%60000/1000),x=ms%1000;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`;}
socket.on('answers:update',answers=>renderAnswers(answers));
socket.on('projector:volume',({volume}={})=>{setProjectorVolume(volume);if(latest&&Number.isFinite(volume))latest.projectorVolume=volume;});
function renderAnswers(answers=[]){const latestByPlayer=new Map();for(const a of answers){const old=latestByPlayer.get(a.playerId);if(!old||a.submittedAt>=old.submittedAt)latestByPlayer.set(a.playerId,a);}const latestAnswers=[...latestByPlayer.values()].sort((a,b)=>a.elapsedMs-b.elapsedMs);$('answerCount').textContent=`${latestAnswers.length} thí sinh đã trả lời`;$('hostAnswers').innerHTML='';if(!latestAnswers.length){$('hostAnswers').innerHTML='<p class="muted">Chưa có câu trả lời.</p>';return;}latestAnswers.forEach(a=>{const card=document.createElement('article');card.className='answercard';const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${a.name} · ${a.team}`;const time=document.createElement('time');time.textContent=formatElapsed(a.elapsedMs);top.append(who,time);const body=document.createElement('p');body.textContent=a.answer;card.append(top,body);$('hostAnswers').append(card);});}
function renderBuzzes(buzzes=[]){if(!$('hostBuzzes'))return;$('buzzCount').textContent=`${buzzes.length} lượt`;$('hostBuzzes').innerHTML='';if(!buzzes.length){$('hostBuzzes').innerHTML='<p class="muted">Chưa có thí sinh bấm chuông.</p>';return;}[...buzzes].sort((a,b)=>a.elapsedMs-b.elapsedMs).forEach((b,i)=>{const card=document.createElement('article');card.className='answercard';const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${i+1}. ${b.name} · ${b.team}`;const time=document.createElement('time');time.textContent=formatElapsed(b.elapsedMs);top.append(who,time);card.append(top);$('hostBuzzes').append(card);});}
function queueNewProjectorBuzzes(state,previous){if(role!=='projector'||!previous)return;if(state.buzzerAlwaysOpen&&!(previous.buzzes||[]).length&&(state.buzzes||[]).length)queueProjectorBuzz();else if(!state.buzzerAlwaysOpen&&!previous.buzzerAlwaysOpen&&state.winnerId&&state.winnerId!==previous.winnerId)queueProjectorBuzz();}
socket.on('projector:audio',({type}={})=>{if(role==='projector'&&['correct','wrong','start','end','opening','blank','vcnv15','tt20','tt30','tt40','speedQuestionOpen','showAnswerVCNV','showAnswerTT'].includes(type))queueProjectorAudio(type);});
function renderBase(state){const previous=latest;if(!state)return;queueNewProjectorBuzzes(state,previous);latest=state;if(Number.isFinite(state.projectorVolume))setProjectorVolume(state.projectorVolume);if(role==='projector')syncProjectorOpeningMusic(state);if(role==='host'&&!$('hostQuestionInput').matches(':focus'))$('hostQuestionInput').value=state.question||'';if(role==='projector'){renderProjector(state);updateTimer();return;}const names={waiting:'ĐANG CHỜ',playing:'CHUÔNG ĐANG MỞ',won:'ĐÃ CÓ NGƯỜI BẤM',locked:'ĐÃ KHÓA',timeout:'HẾT THỜI GIAN'};const winner=state.players.find(p=>p.id===state.winnerId);
if(role==='host'){$('hostStatus').textContent=names[state.status]||state.status;$('hostStatus').className='status '+(state.status==='playing'?'live':state.status==='won'?'won':'');$('hostWinner').classList.add('hidden');$('hostWinner').textContent='';$('alwaysOpen').checked=Boolean(state.buzzerAlwaysOpen);$('playerCount').textContent=`${state.players.length} người`;renderHostPlayers(state.players,state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId);renderBuzzes(state.buzzes||[]);$('startRoundDelayed').disabled=Boolean(state.buzzerCountdownDeadline);}
if(role==='player'){const wasAnswering=Boolean(previous&&previous.independentTimer&&previous.independentTimer.running&&previous.independentTimer.remainingMs>0);const isAnswering=Boolean(state.independentTimer&&state.independentTimer.running&&state.independentTimer.remainingMs>0);if(isAnswering&&!wasAnswering){$('answerInput').value='';$('answerInput').disabled=false;setTimeout(()=>$('answerInput').focus(),0);} $('playerStatus').textContent=names[state.status]||state.status;$('playerStatus').className='status '+(state.status==='playing'?'live':state.status==='won'?'won':'');const me=state.players.find(p=>p.id===myId);$('myScore').textContent=me?me.score:0;if(me&&me.latestAnswer){$('lastAnswerText').textContent=me.latestAnswer.answer;$('lastAnswerTime').textContent=`Đã gửi lúc ${formatElapsed(me.latestAnswer.elapsedMs)}`;}const canBuzz=state.status==='playing'&&!state.buzzerCountdownDeadline&&(state.buzzerAlwaysOpen?!Boolean(me&&me.buzzedAt):!state.winnerId);$('buzzButton').disabled=!canBuzz;$('buzzButton').classList.toggle('ready',canBuzz);$('buzzButton').classList.toggle('pressed',state.buzzerAlwaysOpen?Boolean(me&&me.buzzedAt):state.winnerId===myId);const canSubmitAnswer=isAnswering;$('answerInput').disabled=!canSubmitAnswer;$('submitAnswer').disabled=!canSubmitAnswer;$('answerMessage').textContent=canSubmitAnswer?'Bạn có thể gửi nhiều câu trả lời cho đến khi hết giờ. Nhấn Enter để gửi nhanh (Shift + Enter để xuống dòng).':'Chờ Host bắt đầu hoặc tiếp tục thời gian trả lời...';$('answerMessage').className='muted';$('playerMessage').textContent=state.buzzerCountdownDeadline?'Chuông sẽ mở sau khi đếm ngược kết thúc.':state.buzzerAlwaysOpen&&state.status==='playing'?(me&&me.buzzedAt?'Bạn đã bấm chuông. Hãy chờ Host!':'Chuông luôn mở – mỗi thí sinh được bấm một lần!'):winner?(winner.id===myId?'Bạn đã bấm chuông đầu tiên!':`${winner.name} đã bấm chuông trước.`):state.status==='playing'?'Chuông đã mở – hãy bấm thật nhanh!':state.status==='timeout'?'Đã hết thời gian.':state.status==='locked'?'Chuông đã khóa. Ô trả lời hoạt động theo đồng hồ riêng.':'Chờ Host mở chuông…';$('playerScoreboard').innerHTML='';const fastestId=state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId;[...state.players].sort((a,b)=>b.score-a.score).forEach(p=>$('playerScoreboard').append(scoreRow(p,false,p.id===fastestId)));}
if((lastStatus==='playing'||lastStatus==='locked')&&state.status==='won')sound('win');if(state.status==='playing'&&lastStatus!=='playing')sound('open');lastStatus=state.status;updateTimer();updateIndependentTimer();}
function render(state){
 renderBase(state);
 if(!state)return;
 if(role==='player')renderPlayerQuestion(state);
 if(role==='host')updateHostRoundButtons(state.roundMode||'opening');
 if(role==='host')setOpeningNavigationEnabled(Boolean(state.openingQuestionRound&&Number.isInteger(state.openingQuestionIndex)));
 if(role==='host'){refreshSpotlightControls(state);syncHostOpeningAnswer(state);applySpotlightClass($('hostPlayers'),state.players);}
 else if(role==='player')applySpotlightClass($('playerScoreboard'),[...state.players].sort((a,b)=>b.score-a.score));
 else if(role==='projector')applySpotlightClass($('projectorScoreboard'),[...state.players].sort((a,b)=>b.score-a.score));
}
function renderPlayerQuestion(state){
 const projector=role==='projector';
 const display=$(projector?'projectorPlayerQuestion':'questionDisplay'),text=$(projector?'projectorPlayerQuestionText':'questionDisplayText'),media=$(projector?'projectorPlayerQuestionMedia':'questionDisplayMedia');
 const mediaRound=(state.roundMode==='obstacle'||state.roundMode==='speed')&&Boolean(activeRoundMedia);
 display.classList.toggle('round-media-active',mediaRound);
 text.textContent=state.question||'CÂU HỎI';
 media.classList.toggle('hidden',!mediaRound||!activeRoundMedia);
 if(!mediaRound||!activeRoundMedia){
  pendingSpeedVideoPlayback=false;
  videoPlaybackRequestId++;
  media.querySelector('video')?.pause();
  media.replaceChildren();
  if(activeRoundMediaObjectUrl){URL.revokeObjectURL(activeRoundMediaObjectUrl);activeRoundMediaObjectUrl=null;}
  return;
 }
 const mediaKey=`${state.roundMode}:${activeRoundMediaVersion}`;
 if(media.firstElementChild?.dataset.mediaKey===mediaKey)return;
 media.querySelector('video')?.pause();
 media.replaceChildren();
 if(activeRoundMediaObjectUrl)URL.revokeObjectURL(activeRoundMediaObjectUrl);
 activeRoundMediaObjectUrl=URL.createObjectURL(new Blob([activeRoundMedia.data],{type:activeRoundMedia.type}));
 const element=document.createElement(activeRoundMedia.type.startsWith('video/')?'video':'img');
 element.dataset.mediaKey=mediaKey;
 element.src=activeRoundMediaObjectUrl;
 if(element instanceof HTMLVideoElement){
  element.controls=state.roundMode!=='speed';
  element.preload='metadata';
  element.playsInline=true;
  if(state.roundMode==='speed'){
   element.muted=true;
   element.defaultMuted=true;
   element.volume=0;
   element.setAttribute('muted','');
   element.setAttribute('playsinline','');
   element.disablePictureInPicture=true;
   element.setAttribute('controlslist','nodownload noplaybackrate');
  }
 }
 else element.alt=activeRoundMedia.name||'Media câu hỏi';
 media.append(element);
 if(element instanceof HTMLVideoElement&&pendingSpeedVideoPlayback)startPlayerSpeedVideo(element);
}
socket.on('round:video:play',()=>{
 if(!['player','projector'].includes(role)||latest?.roundMode!=='speed')return;
 const video=$(role==='projector'?'projectorPlayerQuestionMedia':'questionDisplayMedia').querySelector('video');
 pendingSpeedVideoPlayback=true;
 if(video)startPlayerSpeedVideo(video);
});
function startPlayerSpeedVideo(video){
 if(!video||!video.isConnected||latest?.roundMode!=='speed')return;
 videoPlaybackRequestId++;
 const requestId=videoPlaybackRequestId;
 video.pause();
 video.muted=true;
 video.defaultMuted=true;
 video.volume=0;
 video.autoplay=true;
 video.setAttribute('muted','');
 video.setAttribute('autoplay','');
 const playFromStart=()=>{
  if(requestId!==videoPlaybackRequestId||!video.isConnected||latest?.roundMode!=='speed')return;
  video.currentTime=0;
  playSpeedVideo(video);
 };
 video.addEventListener('canplay',playFromStart,{once:true});
 video.load();
}
function playSpeedVideo(video){
 if(!video.isConnected||latest?.roundMode!=='speed')return;
 pendingSpeedVideoPlayback=false;
 video.play().catch(error=>{if(error.name!=='AbortError')toast(`Không thể phát video câu Tăng tốc: ${error.message}`);});
}
socket.on('round:media',media=>{
 if(!['player','projector'].includes(role))return;
 activeRoundMedia=media&&typeof media.data!=='undefined'?media:null;
 activeRoundMediaVersion++;
 if(latest)renderPlayerQuestion(latest);
});
socket.on('host:database:questions:update',questions=>{
 if(role!=='host'||!Array.isArray(questions))return;
 databaseQuestions=questions;
 refreshSpotlightControls(latest);
 syncHostOpeningAnswer(latest);
});
socket.on('host:database:speed-questions:update',questions=>{
 if(role!=='host'||!Array.isArray(questions))return;
 speedQuestionSlots=questions;
 renderSpeedQuestionSelect();
 syncHostOpeningAnswer(latest);
});
function setOpeningNavigationEnabled(enabled){$('nextOpeningQuestion').disabled=!enabled;$('previousOpeningQuestion').disabled=!enabled;}
function applySpotlightClass(container,players){const highlightedId=latest?.buzzerAlwaysOpen?fastestBuzzerId(latest.buzzes):latest?.spotlightPlayerId;[...container.querySelectorAll('.playerrow,.projector-player')].forEach((row,index)=>row.classList.toggle('spotlight-player',players[index]?.id===highlightedId));}
function syncHostOpeningAnswer(state){
 if(role!=='host')return;
 if(activeSpeedQuestionSlot!==null&&!state?.openingQuestionRound){
  $('hostAnswerNote').value=speedQuestionSlots[activeSpeedQuestionSlot]?.answer||'';
  return;
 }
 if(!state?.openingQuestionRound||!Number.isInteger(state.openingQuestionIndex)){ $('hostAnswerNote').value=''; return; }
 const questions=databaseQuestions.filter(question=>question.round===state.openingQuestionRound).sort((a,b)=>(a.sourceRow||0)-(b.sourceRow||0));
 $('hostAnswerNote').value=questions[state.openingQuestionIndex]?.answer||'';
}
function renderProjector(state){const playerRound=state.roundMode==='obstacle'||state.roundMode==='speed';$('projectorView').classList.toggle('projector-round-player-mode',playerRound);$('projectorQuestion').textContent=state.question||'CÂU HỎI';fitProjectorQuestion();const board=$('projectorScoreboard');board.innerHTML='';const projectorPlayerBoard=$('projectorPlayerScoreboard');projectorPlayerBoard.innerHTML='';const fastestId=state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId;const players=[...state.players].sort((a,b)=>b.score-a.score);if(!players.length){const empty=document.createElement('p');empty.className='projector-empty';empty.textContent='Đang chờ thí sinh';board.append(empty);const playerEmpty=document.createElement('p');playerEmpty.className='muted';playerEmpty.textContent='Đang chờ thí sinh';projectorPlayerBoard.append(playerEmpty);}else{players.forEach(p=>{const row=document.createElement('div');row.className='projector-player';if(p.id===fastestId)row.classList.add('fastest-buzzer');const identity=document.createElement('div');identity.className='projector-player-identity';const name=document.createElement('strong');name.textContent=p.name;identity.append(name);const score=document.createElement('strong');score.className='projector-player-score';score.textContent=p.score;row.append(identity,score);board.append(row);projectorPlayerBoard.append(scoreRow(p,false,p.id===fastestId));});}scaleProjectorScoreboard();renderPlayerQuestion(state);applySpotlightClass(projectorPlayerBoard,players);}
function fastestBuzzerId(buzzes=[]){return buzzes[0]?.playerId||null;}
function fitProjectorQuestion(){const question=$('projectorQuestion');if(!question||!question.clientWidth||!question.clientHeight)return;question.style.removeProperty('font-size');const baseSize=parseFloat(getComputedStyle(question).fontSize),measure=document.createElement('div');measure.textContent=question.textContent;Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',width:`${question.clientWidth}px`,height:'auto',minHeight:'0',maxHeight:'none',overflow:'visible',display:'block',flex:'none',padding:'0',border:'0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:'1.2',fontFamily:getComputedStyle(question).fontFamily});document.body.append(measure);let low=.5,high=baseSize;for(let i=0;i<18;i++){const size=(low+high)/2;measure.style.fontSize=`${size}px`;if(measure.scrollHeight<=question.clientHeight)low=size;else high=size;}question.style.fontSize=`${low>=baseSize-.1?baseSize:low}px`;measure.remove();}
function scaleProjectorScoreboard(){if(!$('projectorView')||$('projectorView').classList.contains('hidden'))return;const panel=document.querySelector('.projector-score-panel'),board=$('projectorScoreboard');if(!panel||!board)return;const players=board.querySelectorAll('.projector-player');if(!players.length){board.style.setProperty('--projector-rows','1');board.style.setProperty('--projector-scale','1');return;}const rowHeight=board.clientHeight/players.length,scale=Math.max(.15,Math.min(1,rowHeight/148.5,board.clientWidth/607.5));board.style.setProperty('--projector-rows',String(players.length));board.style.setProperty('--projector-scale',String(scale));}
const projectorObserver=new ResizeObserver(()=>{scaleProjectorScoreboard();fitProjectorQuestion();});projectorObserver.observe(document.querySelector('.projector-score-panel'));projectorObserver.observe(document.querySelector('.projector-question-panel'));window.addEventListener('resize',()=>{scaleProjectorScoreboard();fitProjectorQuestion();});
function scoreRow(p,actions,highlight=false){const row=document.createElement('div');row.className='playerrow';if(highlight)row.classList.add('fastest-buzzer');if(actions&&p.focused===false){row.classList.add('unfocused-player');row.title='Thí sinh đang rời khỏi trang này hoặc không focus vào trang.';}const name=document.createElement('div');name.innerHTML=`<div class="playername"><i class="${p.connected?'connected':'connected disconnected'}"></i></div><div class="playerteam"></div>`;name.querySelector('.playername').append(document.createTextNode(p.name));name.querySelector('.playerteam').textContent=p.team;const pts=document.createElement('div');pts.className='points';pts.textContent=p.score;row.append(name,pts);if(actions){const a=document.createElement('div');a.className='scoreactions';for(const [label,delta,cls] of [['+10',10,''],['-5',-5,'minus']]){const b=document.createElement('button');b.textContent=label;b.className=cls;b.onclick=()=>changeScore(p.id,delta);a.append(b);}const customInput=document.createElement('input');customInput.type='number';customInput.min='-100';customInput.max='1000';customInput.step='1';customInput.placeholder='Điểm';customInput.setAttribute('aria-label',`Số điểm thay đổi cho ${p.name}`);const customButton=document.createElement('button');customButton.textContent='ÁP DỤNG';customButton.title='Áp dụng số điểm đã nhập';customButton.onclick=()=>{const delta=Number(customInput.value);if(!Number.isInteger(delta)||delta< -100||delta>1000)return toast('Nhập số nguyên từ -100 đến 1000.');changeScore(p.id,delta);};a.append(customInput,customButton);const rm=document.createElement('button');rm.textContent='×';rm.title='Xóa người chơi';rm.onclick=()=>emitAck('host:remove',{playerId:p.id});a.append(rm);row.append(a);}return row;}
async function changeScore(playerId,delta){const r=await emitAck('host:score',{playerId,delta});if(!r.ok){toast(r.error);return false;}return true;}
function renderHostPlayers(players,fastestId){$('hostPlayers').innerHTML='';if(!players.length){$('hostPlayers').innerHTML='<p class="muted">Chưa có người chơi. Chia sẻ mã phòng để mọi người tham gia.</p>';return;}players.forEach(p=>$('hostPlayers').append(scoreRow(p,true,p.id===fastestId)));}
async function loadDatabase(){const r=await emitAck('host:database:get');if(!r.ok){toast(r.error);show(role==='database'?'home':'hostView');return;}databaseQuestions=r.questions;speedQuestionSlots=(Array.isArray(r.speedQuestions)?r.speedQuestions:[]).slice(0,4);while(speedQuestionSlots.length<4)speedQuestionSlots.push({prompt:'',answer:'',media:null});speedQuestionSlots.forEach(slot=>{slot.answer||='';});obstacleCourse=r.obstacleCourse||{rows:Array.from({length:4},()=>({answer:'',question:''})),keyword:'',fullAnswer:''};obstacleCourse.rows=Array.from({length:4},(_,index)=>obstacleCourse.rows?.[index]||{answer:'',question:''});finishRounds=Array.from({length:4},(_,round)=>Array.from({length:7},(_,index)=>r.finishRounds?.[round]?.[index]||{question:'',answer:''}));renderObstacleCourse();renderFinishRounds();renderSpeedQuestionSlots();renderSpeedQuestionSelect();renderDatabase();refreshSpotlightControls(latest);syncHostOpeningAnswer(latest);}
function renderFinishRounds(){
 const container=$('databaseFinishRounds');
 container.replaceChildren();
 for(let round=0;round<4;round++){
  const section=document.createElement('section');
  section.className='database-finish-sheet';
  const table=document.createElement('table');
  table.className='database-finish-table';
  const columns=document.createElement('colgroup');
  for(const columnClass of ['finish-points-column','finish-question-column','finish-answer-column']){
   const column=document.createElement('col');column.className=columnClass;columns.append(column);
  }
  table.append(columns);
  const head=document.createElement('thead'),titleRow=document.createElement('tr'),title=document.createElement('th');
  title.colSpan=3;title.textContent=`Về đích ${round+1}`;titleRow.append(title);head.append(titleRow);table.append(head);
  const body=document.createElement('tbody');
  for(let index=0;index<7;index++){
   const row=document.createElement('tr');
   if(index===0||index===3||index===6){
    const points=document.createElement('th');
    points.scope='rowgroup';points.rowSpan=index===0||index===3?3:1;points.textContent=index===0?'20':index===3?'30':'40';
    row.append(points);
   }
   const entry=finishRounds[round][index]||{question:'',answer:''};
   for(const [field,label] of [['question','câu hỏi'],['answer','đáp án']]){
    const cell=document.createElement('td'),input=document.createElement('textarea');
    input.rows=1;input.maxLength=5000;input.value=entry[field]||'';
    input.setAttribute('aria-label',`Về đích ${round+1}, ${label} (${index+1})`);
    input.addEventListener('change',()=>saveFinishRoundEntry(round,index,{question:row.querySelector('[aria-label*="câu hỏi"]')?.value||'',answer:row.querySelector('[aria-label*="đáp án"]')?.value||''}));
    cell.append(input);row.append(cell);
   }
   body.append(row);
  }
  table.append(body);section.append(table);container.append(section);
 }
}
async function saveFinishRoundEntry(round,index,entry){
 const result=await emitAck('host:database:finish-round:update',{round,index,...entry});
 if(!result.ok){toast(result.error);await loadDatabase();return;}
 finishRounds=result.finishRounds;
}
function splitGraphemes(value){
 if(typeof Intl.Segmenter==='function')return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].map(item=>item.segment);
 return Array.from(value);
}
function readObstacleAnswer(rowElement){return [...rowElement.querySelectorAll('.obstacle-answer-grid input')].map(input=>input.value).join('');}
function obstacleCharacterCount(value){return splitGraphemes(value).filter(character=>!/\s/u.test(character)).length;}
function updateObstacleLetterCount(rowElement){rowElement.querySelector('.obstacle-letter-count').textContent=String(obstacleCharacterCount(readObstacleAnswer(rowElement)));}
function renderObstacleCourse(){
 obstacleCourse.rows.forEach((row,index)=>{
  const element=$('databaseObstacleCourse').querySelector(`[data-obstacle-row="${index}"]`);
  const cells=splitGraphemes(row.answer||'');
  element.querySelectorAll('.obstacle-answer-grid input').forEach((input,cellIndex)=>{input.value=cells[cellIndex]||'';});
  element.querySelector('.obstacle-question').value=row.question||'';
  updateObstacleLetterCount(element);
 });
 $('databaseObstacleCourse').querySelector('.obstacle-keyword').value=obstacleCourse.keyword||'';
 $('databaseObstacleCourse').querySelector('.obstacle-keyword-question').value=obstacleCourse.keywordQuestion||'';
 updateObstacleKeywordCount();
 $('databaseObstacleCourse').querySelector('.obstacle-full-answer').value=obstacleCourse.fullAnswer||'';
 updateObstacleFullAnswerCount();
 renderObstacleCourseMedia();
}
function renderObstacleCourseMedia(fileOrBlob=null){
 const media=obstacleCourse.media,preview=$('obstacleMediaPreview');
 obstacleMediaLoadVersion++;
 const version=obstacleMediaLoadVersion;
 if(obstacleMediaObjectUrl){URL.revokeObjectURL(obstacleMediaObjectUrl);obstacleMediaObjectUrl=null;}
 preview.replaceChildren();
 $('obstacleMediaName').textContent=media?media.name:'Tối đa 10 MB';
 $('obstacleMediaButton').textContent=media?'XÓA MEDIA':'CHỌN MEDIA';
 if(!media){const placeholder=document.createElement('span');placeholder.textContent='Media VCNV';preview.append(placeholder);return;}
 if(fileOrBlob){showObstacleMedia(preview,media,URL.createObjectURL(fileOrBlob));return;}
 preview.textContent='Đang tải media…';
 emitAck('host:database:obstacle-media:get').then(result=>{
  if(version!==obstacleMediaLoadVersion)return;
  if(!result.ok){toast(result.error);preview.textContent='Không thể tải media VCNV.';return;}
  showObstacleMedia(preview,result.media,URL.createObjectURL(new Blob([result.media.data],{type:result.media.type})));
 }).catch(error=>{
  if(version!==obstacleMediaLoadVersion)return;
  preview.textContent='Không thể tải media VCNV.';
  toast(`Không thể tải media VCNV: ${error.message}`);
 });
}
function showObstacleMedia(preview,media,url){
 obstacleMediaObjectUrl=url;
 const element=document.createElement(media.type.startsWith('video/')?'video':'img');
 element.src=url;
 if(element instanceof HTMLVideoElement){element.controls=true;element.preload='metadata';element.playsInline=true;}
 else element.alt=media.name;
 preview.replaceChildren(element);
}
function updateObstacleKeywordCount(){
 $('databaseObstacleCourse').querySelector('.obstacle-keyword-count').textContent=String(obstacleCharacterCount($('databaseObstacleCourse').querySelector('.obstacle-keyword').value));
}
function updateObstacleFullAnswerCount(){
 $('databaseObstacleCourse').querySelector('.obstacle-full-answer-count').textContent=String(obstacleCharacterCount($('databaseObstacleCourse').querySelector('.obstacle-full-answer').value));
}
async function saveObstacleCourse(update){
 const result=await emitAck('host:database:obstacle-course:update',update);
 if(!result.ok){toast(result.error);await loadDatabase();return;}
 obstacleCourse=result.obstacleCourse;
}
function renderSpeedQuestionSlots(){
 speedQuestionSlots.forEach((slot,index)=>{
  const card=$('speedQuestionSlots').querySelector(`[data-speed-slot="${index}"]`);
  card.querySelector('.database-speed-prompt').value=slot.prompt||'';
  card.querySelector('.database-speed-answer').value=slot.answer||'';
  speedMediaLoadVersions[index]++;
  renderSpeedMediaPreview(index);
  if(!slot.media)return;
  const version=speedMediaLoadVersions[index];
  const preview=card.querySelector('.database-speed-preview');
  preview.replaceChildren(document.createTextNode('Đang tải media…'));
  emitAck('host:database:speed-media:get',{slot:index}).then(result=>{
   if(version!==speedMediaLoadVersions[index])return;
   if(!result.ok){toast(result.error);renderSpeedMediaPreview(index);return;}
   speedQuestionSlots[index].media={name:result.media.name,type:result.media.type,size:result.media.size};
   renderSpeedMediaPreview(index,new Blob([result.media.data],{type:result.media.type}));
  }).catch(error=>toast(`Không thể tải media Tăng tốc ${index+1}: ${error.message}`));
 });
}
function renderSpeedMediaPreview(index,fileOrBlob=null){
 const card=$('speedQuestionSlots').querySelector(`[data-speed-slot="${index}"]`),preview=card.querySelector('.database-speed-preview'),media=speedQuestionSlots[index].media;
 if(speedMediaObjectUrls[index]){URL.revokeObjectURL(speedMediaObjectUrls[index]);speedMediaObjectUrls[index]=null;}
 preview.replaceChildren();
 card.querySelector('.database-speed-filename').textContent=media?media.name:'Tối đa 10 MB';
 if(!media){const placeholder=document.createElement('span');placeholder.textContent='Ảnh';preview.append(placeholder);return;}
 if(fileOrBlob)speedMediaObjectUrls[index]=URL.createObjectURL(fileOrBlob);
 if(!speedMediaObjectUrls[index]){const placeholder=document.createElement('span');placeholder.textContent='Media';preview.append(placeholder);return;}
 const element=document.createElement(media.type.startsWith('video/')?'video':'img');
 element.src=speedMediaObjectUrls[index];
 if(element instanceof HTMLVideoElement){element.controls=true;element.preload='metadata';element.playsInline=true;}
 else element.alt=media.name;
 preview.append(element);
}
function refreshSpotlightControls(state){
 if(role!=='host')return;
 const rounds=['Thí sinh 1','Thí sinh 2','Thí sinh 3','Thí sinh 4','Lượt chung'].filter(round=>
  databaseQuestions.some(question=>question.round===round&&typeof question.prompt==='string'&&question.prompt.trim())
 );
 const roundSelect=$('spotlightRound'),playerSelect=$('spotlightPlayer');
 const roundOptions=[['',rounds.length?'Chọn lượt thi…':'Chưa có lượt trong Database'],...rounds.map(round=>[round,round])];
 if(roundSelect.options.length!==roundOptions.length||roundOptions.some(([value,label],index)=>roundSelect.options[index]?.value!==value||roundSelect.options[index]?.textContent!==label)){
  roundSelect.replaceChildren(...roundOptions.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
 }
 const players=state&&Array.isArray(state.players)?state.players:[];
 const playerOptions=[['','Không chọn thí sinh'],...players.map(player=>[player.id,`${player.name} · ${player.team}`])];
 if(playerSelect.options.length!==playerOptions.length||playerOptions.some(([value,label],index)=>playerSelect.options[index]?.value!==value||playerSelect.options[index]?.textContent!==label)){
  playerSelect.replaceChildren(...playerOptions.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
 }
 roundSelect.value=state&&rounds.includes(state.spotlightRound)?state.spotlightRound:'';
 playerSelect.value=state&&players.some(player=>player.id===state.spotlightPlayerId)?state.spotlightPlayerId:'';
 $('openingAnswerCorrect').disabled=!playerSelect.value;
 $('openingAnswerIncorrect').disabled=!playerSelect.value;
}
async function saveSpotlightSelection(){
 if(role!=='host')return;
 const result=await emitAck('host:spotlight',{round:$('spotlightRound').value,playerId:$('spotlightPlayer').value});
 if(!result.ok){toast(result.error);refreshSpotlightControls(latest);}
}
function renderDatabase(){
 const container=$('databaseQuestions');
 container.replaceChildren();
 $('databaseCount').textContent=`${databaseQuestions.length} câu hỏi`;
 $('clearDatabase').disabled=databaseQuestions.length===0;
 const rounds=[
  {name:'Thí sinh 1',title:'Lượt thí sinh 1',startRow:4},
  {name:'Thí sinh 2',title:'Lượt thí sinh 2',startRow:26},
  {name:'Thí sinh 3',title:'Lượt thí sinh 3',startRow:48},
  {name:'Thí sinh 4',title:'Lượt thí sinh 4',startRow:70},
  {name:'Lượt chung',title:'Lượt chung',startRow:92}
 ];
 rounds.forEach(round=>{
  const section=document.createElement('section');
  section.className='database-round-sheet';
  const title=document.createElement('h2');
  title.innerHTML=`KHỞI ĐỘNG<br>${round.title}`;
  section.append(title);
  const table=document.createElement('table');
  table.className='database-table';
  const thead=document.createElement('thead'),headerRow=document.createElement('tr');
  for(const label of ['Câu','Nội dung','Đáp án']){
   const th=document.createElement('th');th.scope='col';th.textContent=label;headerRow.append(th);
  }
  thead.append(headerRow);table.append(thead);
  const body=document.createElement('tbody');
  const questions=databaseQuestions.filter(question=>question.round===round.name);
  const rows=Array(20).fill(null);
  const unmappedQuestions=[];
  questions.forEach(question=>{
   const sourceIndex=Number.isInteger(question.sourceRow)?question.sourceRow-round.startRow:-1;
   if(sourceIndex>=0&&sourceIndex<20&&!rows[sourceIndex])rows[sourceIndex]=question;
   else unmappedQuestions.push(question);
  });
  unmappedQuestions.forEach(question=>{const emptyIndex=rows.findIndex(item=>!item);if(emptyIndex>=0)rows[emptyIndex]=question;});
  rows.forEach((question,index)=>{
   const row=document.createElement('tr');
   const number=document.createElement('th');number.scope='row';number.textContent=String(index+1);row.append(number);
   const promptCell=document.createElement('td'),prompt=document.createElement('textarea');
   prompt.rows=2;prompt.maxLength=5000;prompt.value=question?.prompt||'';prompt.setAttribute('aria-label',`${round.title}, câu ${index+1}`);
   promptCell.append(prompt);
   const answerCell=document.createElement('td'),answer=document.createElement('textarea');
   answer.rows=2;answer.maxLength=5000;answer.value=question?.answer||'';answer.setAttribute('aria-label',`${round.title}, đáp án câu ${index+1}`);
   answerCell.append(answer);row.append(promptCell,answerCell);body.append(row);
   const persist=()=>saveRoundQuestion(round,index,question,prompt.value,answer.value);
   prompt.addEventListener('change',persist);
   answer.addEventListener('change',persist);
  });
  table.append(body);section.append(table);container.append(section);
 });
}
async function saveRoundQuestion(round,index,existing,prompt,answer){
 if(!prompt.trim()){
  if(existing){
   const result=await emitAck('host:database:delete',{id:existing.id});
   if(!result.ok)return toast(result.error);
   databaseQuestions=result.questions;renderDatabase();refreshSpotlightControls(latest);syncHostOpeningAnswer(latest);
  }else if(answer.trim())toast('Nhập nội dung câu hỏi trước khi lưu đáp án.');
  return;
 }
 const question={...(existing||{}),round:round.name,prompt,answer,notes:existing?.notes||'',points:existing?.points||0,sourceSheet:existing?.sourceSheet||'Khởi Động',sourceRow:existing?.sourceRow||round.startRow+index};
 const result=existing
  ?await emitAck('host:database:update',{id:existing.id,question})
  :await emitAck('host:database:add',{question});
 if(!result.ok)return toast(result.error);
 databaseQuestions=result.questions;
 if(!existing)renderDatabase();
 refreshSpotlightControls(latest);syncHostOpeningAnswer(latest);
}
function formatClock(ms){const total=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}
function updateIndependentTimer(){const t=latest&&latest.independentTimer;if(!t)return;const remaining=t.running&&t.deadline?Math.max(0,t.deadline-Date.now()):t.remainingMs;if($('hostIndependentDisplay'))$('hostIndependentDisplay').textContent=formatClock(remaining);if($('playerIndependentDisplay'))$('playerIndependentDisplay').textContent=formatClock(remaining);if($('projectorIndependentDisplay'))$('projectorIndependentDisplay').textContent=formatClock(remaining);if($('independentReset'))$('independentReset').disabled=Boolean(t.running&&remaining>0);if(role==='player'&&remaining<=0){$('answerInput').disabled=true;$('submitAnswer').disabled=true;}}
function updateTimer(){
 clearInterval(tickHandle);
 const paint=()=>{
  if(!latest){$('hostTimer').textContent='--';$('playerTimer').textContent='--';$('projectorQuestionTimerBox').classList.add('hidden');$('projectorQuestionTimer').textContent='';return;}
  const now=Date.now();
  const countdownDeadline=latest.buzzerCountdownDeadline;
  const countdownActive=Boolean(countdownDeadline&&countdownDeadline>now);
  const buzzerActive=Boolean(latest.deadline&&['playing','won','locked'].includes(latest.status));
  const buzzerDeadline=countdownDeadline|| (buzzerActive?latest.deadline:null);
  const buzzerSeconds=buzzerDeadline?(countdownDeadline?Math.max(1,Math.ceil((buzzerDeadline-now)/1000)):Math.max(0,Math.ceil((buzzerDeadline-now)/1000))):null;
  const openingSeconds=latest.openingDeadline?Math.max(0,Math.ceil((latest.openingDeadline-now)/1000)):null;
  const showOpeningTimer=!countdownDeadline&&openingSeconds!==null;
  if(role==='projector'){
   const showProjectorTimer=showOpeningTimer&&openingSeconds>0;
   $('projectorQuestionTimerBox').classList.toggle('hidden',!showProjectorTimer);
   $('projectorQuestionTimer').textContent=showProjectorTimer?String(openingSeconds):'';
  }
  if(role==='player'){
   const canBuzz=canPlayerBuzz();
   $('buzzButton').disabled=!canBuzz;
   $('buzzButton').classList.toggle('ready',canBuzz);
   const firstBuzzerId=fastestBuzzerId(latest.buzzes);
   const wonByPlayer=latest.buzzerAlwaysOpen?firstBuzzerId===myId:latest.winnerId===myId;
   const winnerSeconds=latest.winnerCountdownDeadline&&wonByPlayer?Math.max(0,Math.ceil((latest.winnerCountdownDeadline-now)/1000)):null;
   const buzzLabel=$('buzzButton').querySelector('span');
   if(buzzLabel)buzzLabel.textContent=countdownDeadline?String(buzzerSeconds):winnerSeconds!==null?String(winnerSeconds):'BẤM CHUÔNG';
   $('playerTimer').textContent=showOpeningTimer?`${openingSeconds}s`:'--';
  }
  if(role==='host'){
   if(countdownDeadline){
    $('hostTimer').textContent=`${buzzerSeconds}s`;
    $('hostStatus').textContent=`CHUÔNG MỞ SAU ${buzzerSeconds}s`;
    $('hostStatus').className='status';
   }else if(openingSeconds!==null)$('hostTimer').textContent=`${openingSeconds}s`;
   else if(buzzerActive)$('hostTimer').textContent=`${buzzerSeconds}s`;
   else $('hostTimer').textContent='--';
  }
  if(buzzerActive&&buzzerSeconds===0&&role==='player'){$('answerInput').disabled=true;$('submitAnswer').disabled=true;}
 };
 paint();
 if(latest&&(latest.buzzerCountdownDeadline||latest.winnerCountdownDeadline||latest.openingDeadline||(latest.deadline&&['playing','won','locked'].includes(latest.status))))tickHandle=setInterval(paint,100);
}
socket.on('room:update',render);socket.on('connect',async()=>{const params=new URLSearchParams(location.search),projectorCode=params.get('projector'),playerCode=params.get('room'),databaseCode=params.get('database');if(projectorCode){role='projector';show('projectorView');const r=await emitAck('projector:join',{code:projectorCode});if(!r.ok){$('projectorQuestion').textContent=r.error;return;}roomCode=r.state.code;render(r.state);return;}if(databaseCode){role='database';show('hostDatabase');$('closeDatabase').textContent='ĐÓNG TRANG';const storageKey=`olympia-database-token:${databaseCode}`;let token=location.hash.slice(1)||sessionStorage.getItem(storageKey)||'';if(!token){toast('Thiếu quyền truy cập Database. Hãy mở Database từ màn hình Host.');show('home');return;}const r=await emitAck('host:database:join',{code:databaseCode,token});if(!r.ok){sessionStorage.removeItem(storageKey);toast(r.error);show('home');return;}roomCode=r.code;sessionStorage.setItem(storageKey,token);if(location.hash)history.replaceState(null,'',`${location.pathname}${location.search}`);await loadDatabase();return;}if(playerCode){$('joinCode').value=playerCode.toUpperCase();show('playerSetup');}});socket.on('disconnect',()=>toast('Mất kết nối máy chủ. Đang thử kết nối lại…'));
