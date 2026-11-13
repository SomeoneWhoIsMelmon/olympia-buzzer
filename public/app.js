const socket = io();
const $ = id => document.getElementById(id);
const views = ['home','hostSetup','playerSetup','hostView','hostDatabase','playerView','projectorView'];
let role = null, roomCode = null, myId = null, myTeam = null, latest = null, hostLink = null, lastStatus = null, audioCtx = null, projectorMasterGain = null, projectorVolume = 1, tickHandle = null, independentTickHandle = setInterval(updateIndependentTimer, 100), projectorAudioQueue = [], projectorAudioBuffers = new Map(), projectorAudioReady = false, projectorAudioLoading = new Map(), projectorAudioResumePending = false, projectorAudioGeneration = 0, projectorActiveAudioSources = new Set(), projectorOpeningMusicSource = null, projectorOpeningMusicKey = null, projectorOpeningMusicGeneration = 0, projectorOpeningAnimationTimeout = null, projectorOpeningPresentationActive = false, projectorFinishAnimationTimeout = null, projectorFinishPresentationActive = false, projectorFinishStartExitTimeout = null, databaseQuestions = [], speedQuestionSlots = Array.from({length:4},()=>({prompt:'',media:null})), obstacleCourse = {rows:Array.from({length:4},()=>({answer:'',question:''})),keyword:'',fullAnswer:'',media:null}, projectorObstacleAnswerCells = Array.from({length:4},()=>Array(15).fill('')), speedMediaObjectUrls = Array(4).fill(null), speedMediaLoadVersions = Array(4).fill(0), obstacleMediaObjectUrl = null, activeRoundMediaObjectUrl = null, activeRoundMedia = null, activeRoundMediaVersion = 0, videoPlaybackRequestId = 0, pendingSpeedVideoPlayback = false, openingCorrectStreak = 0, openingStreakPlayerId = '', openingScorePending = false, activeSpeedQuestionSlot = null;
let finishRounds = Array.from({length:4},()=>Array.from({length:7},()=>({question:'',answer:''})));
let obstacleMediaLoadVersion = 0;
let projectorObstacleQuestionTimeout = null;
let projectorSpeedQuestionTimeout = null;
let projectorSpeedMediaReady = false, projectorSpeedQuestionRequested = false;
let projectorObstacleVerdicts = {}, projectorObstacleMediaObjectUrl = null;
let hostObstacleRevealed = new Set(), hostObstacleMediaObjectUrl = null, hostObstacleRowSelected = null, hostObstacleVerdicts = {};
let selectedHostAnswerIds = new Set(), gradedHostAnswers = new Map();
let serverClockOffsetMs = 0, serverClockSynchronized = false;
const finishAudioFiles={startVDCombined:'StartVDCombined.mp3',startTurnVD:'StartTurnVD.mp3',vd15:'VD15s.mp3',vd20:'VD20s.mp3',vd30:'VD30s.mp3',nshv:'NSHV.mp3',finishCorrect:'Correct.mp3',finishWrong:'FiveSecsForOtherContestants.mp3',finishStealWrong:'Wrong.mp3',correctHN:'CorrectHN.mp3',wrongHN:'WrongHN.mp3',correctCNV:'CorrectCNV.mp3',pickHNCombined:'PickHNCombined.mp3',openHN:'OpenHN.mp3',openAll:'OpenAll.mp3',openPiece:'OpenPiece.mp3',roundStartKD:'StartingKD.ogg',roundStartVCNV:'StartingVCNV.ogg',roundStartTT:'StartingTT.mp3',roundStartVD:'StartingVD.ogg',buzzCNV:'BuzzCNV.mp3',endTurnVD:'EndTurnVD.mp3'};
const hostCueAudioFiles={win:'Winner.mp3',cang1:'Cang1.mp3',cang2:'Cang2.mp3',cang3:'Cang3.mp3',correctDP:'CorrectCNV.mp3',wrongDP:'WrongHN.mp3'};
function show(id){ views.forEach(v => $(v).classList.toggle('hidden',v!==id)); document.body.classList.toggle('player-active',id==='playerView'); document.body.classList.toggle('host-active',id==='hostView'||id==='hostDatabase'); document.body.classList.toggle('database-page-active',id==='hostDatabase'); document.body.classList.toggle('projector-active',id==='projectorView'); }
function toast(msg){ $('toast').textContent=msg; $('toast').classList.remove('hidden'); setTimeout(()=>$('toast').classList.add('hidden'),2600); }
function displayNow(){return serverClockSynchronized?performance.now()+serverClockOffsetMs:Date.now();}
function syncServerClock(){if(!socket.connected)return;const sentAt=performance.now();socket.timeout(5000).emit('time:sync',{},(error,response)=>{if(error){console.warn('Không đồng bộ được đồng hồ máy chủ:',error.message);return;}const receivedAt=performance.now();if(!Number.isFinite(response?.serverTime)){console.warn('Máy chủ trả về thời gian đồng bộ không hợp lệ.');return;}serverClockOffsetMs=response.serverTime-(sentAt+receivedAt)/2;serverClockSynchronized=true;updateTimer();updateIndependentTimer();});}
function canPlayerBuzz(){if(role!=='player'||!latest)return false;const me=latest.players.find(player=>player.id===myId);if(latest.roundMode==='obstacle')return Boolean(latest.obstacleStarted&&me&&!me.obstacleBuzzUsed);if(latest.status!=='playing'||latest.buzzerCountdownDeadline||!latest.deadline||Date.now()>=latest.deadline)return false;if(latest.roundMode==='finish'&&latest.finishPlayerId===myId)return false;return latest.buzzerAlwaysOpen?!Boolean(me&&me.buzzedAt):!latest.winnerId;}
function sound(type){ try { audioCtx ||= new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.connect(g);g.connect(audioCtx.destination);o.type='sine';o.frequency.value=type==='buzz'?880:type==='win'?660:440;g.gain.setValueAtTime(.001,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.18,audioCtx.currentTime+.015);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+(type==='win'?.45:.18));o.start();o.stop(audioCtx.currentTime+(type==='win'?.48:.2)); }catch(e){} }
function setProjectorVolume(volume){if(!Number.isFinite(volume))return;projectorVolume=Math.max(0,Math.min(1,volume));if(projectorMasterGain){projectorMasterGain.gain.setTargetAtTime(projectorVolume,audioCtx.currentTime,.02);}if(role==='host'&&$('projectorVolume')){$('projectorVolume').value=String(Math.round(projectorVolume*100));$('projectorVolumeValue').value=`${Math.round(projectorVolume*100)}%`;}}
function getProjectorOutput(){if(!projectorMasterGain){projectorMasterGain=audioCtx.createGain();projectorMasterGain.gain.value=projectorVolume;projectorMasterGain.connect(audioCtx.destination);}return projectorMasterGain;}
async function loadProjectorAudio(type){if(projectorAudioBuffers.has(type))return projectorAudioBuffers.get(type);if(projectorAudioLoading.has(type))return projectorAudioLoading.get(type);const loading=(async()=>{const context=audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());const files={buzz:'Buzz.mp3',correct:'Correct.mp3',wrong:'Wrong.mp3',start:'StartKD.mp3',end:'EndKD.mp3',opening:'KD60s.mp3',musicA:'KDmusicA.mp3',musicB:'KDmusicB.mp3',musicC:'KDmusicC.mp3',blank:'Blank.ogg',vcnv15:'VCNV15s.mp3',tt20:'TT20s.mp3',tt30:'TT30s.mp3',tt40:'TT40s.mp3',speedQuestionOpen:'OpenQsTT.mp3',showAnswerVCNV:'ShowAnsVCNV.ogg',showAnswerTT:'ShowAnsTT.ogg'};const file=files[type]||finishAudioFiles[type]||hostCueAudioFiles[type];if(!file)throw new Error('Không tìm thấy tệp âm thanh.');const response=await fetch(`/Olympia%20Music/${encodeURIComponent(file)}`);if(!response.ok)throw new Error(`Không tải được ${file} (${response.status}).`);const buffer=await context.decodeAudioData(await response.arrayBuffer());projectorAudioBuffers.set(type,buffer);return buffer;})();projectorAudioLoading.set(type,loading);try{return await loading;}finally{projectorAudioLoading.delete(type);}}
function playNextProjectorAudio(){if(role!=='projector'||!projectorAudioReady||!projectorAudioQueue.length)return;const type=projectorAudioQueue[0],buffer=projectorAudioBuffers.get(type);if(!buffer)return;const context=audioCtx;if(context.state!=='running'){if(!projectorAudioResumePending){projectorAudioResumePending=true;context.resume().then(()=>{projectorAudioResumePending=false;playNextProjectorAudio();}).catch(error=>{projectorAudioResumePending=false;toast(`Không thể tiếp tục phát âm thanh: ${error.message}`);});}return;}projectorAudioQueue.shift();const source=context.createBufferSource();source.buffer=buffer;source.connect(getProjectorOutput());projectorActiveAudioSources.add(source);source.onended=()=>{projectorActiveAudioSources.delete(source);playNextProjectorAudio();};source.start();}
function stopAllProjectorSfx(){if(role!=='projector')return;projectorAudioQueue=[];projectorAudioGeneration++;projectorOpeningMusicGeneration++;const sources=[...projectorActiveAudioSources];projectorActiveAudioSources.clear();for(const source of sources){try{source.stop();}catch{}source.disconnect();}if(projectorOpeningMusicSource){const music=projectorOpeningMusicSource;projectorOpeningMusicSource=null;try{music.stop();}catch{}music.disconnect();}}
function clearProjectorOpeningAnimationTimeout(){if(projectorOpeningAnimationTimeout){clearTimeout(projectorOpeningAnimationTimeout);projectorOpeningAnimationTimeout=null;}}
function startProjectorOpeningEntrance(){if(role!=='projector')return;const view=$('projectorView');clearProjectorOpeningAnimationTimeout();view.classList.remove('projector-opening-exiting','projector-opening-entering');view.classList.add('projector-opening-hidden');void view.offsetWidth;view.classList.add('projector-opening-entering');projectorOpeningAnimationTimeout=setTimeout(()=>{view.classList.remove('projector-opening-entering','projector-opening-hidden');projectorOpeningAnimationTimeout=null;},4800);}
function startProjectorOpeningExit(){if(role!=='projector')return;const view=$('projectorView'),wasHidden=view.classList.contains('projector-opening-hidden');clearProjectorOpeningAnimationTimeout();view.classList.remove('projector-opening-entering');if(wasHidden){view.classList.add('projector-opening-hidden');view.classList.remove('projector-opening-exiting');return;}view.classList.remove('projector-opening-exiting');void view.offsetWidth;view.classList.add('projector-opening-exiting');projectorOpeningAnimationTimeout=setTimeout(()=>{view.classList.remove('projector-opening-exiting');view.classList.add('projector-opening-hidden');projectorOpeningAnimationTimeout=null;},1800);}
function clearProjectorFinishAnimationTimeout(){if(projectorFinishAnimationTimeout){clearTimeout(projectorFinishAnimationTimeout);projectorFinishAnimationTimeout=null;}}
function clearProjectorObstacleQuestionTimeout(){if(projectorObstacleQuestionTimeout){clearTimeout(projectorObstacleQuestionTimeout);projectorObstacleQuestionTimeout=null;}}
function hideProjectorObstacleQuestion(animated=true){if(role!=='projector')return;clearProjectorObstacleQuestionTimeout();const view=$('projectorView'),question=$('projectorObstacleQuestion').parentElement;if(view.classList.contains('projector-obstacle-question-hidden'))return;view.classList.remove('projector-obstacle-question-entering','projector-obstacle-question-exiting');if(!animated){view.classList.add('projector-obstacle-question-hidden');return;}void question.offsetWidth;view.classList.add('projector-obstacle-question-exiting');projectorObstacleQuestionTimeout=setTimeout(()=>{view.classList.remove('projector-obstacle-question-exiting');view.classList.add('projector-obstacle-question-hidden');projectorObstacleQuestionTimeout=null;},800);}
function scheduleProjectorObstacleQuestionEntrance(){if(role!=='projector'||latest?.roundMode!=='obstacle'||!latest.obstacleStarted)return;const view=$('projectorView');if(!view.classList.contains('projector-obstacle-question-hidden')&&!view.classList.contains('projector-obstacle-question-exiting'))return;clearProjectorObstacleQuestionTimeout();projectorObstacleQuestionTimeout=setTimeout(()=>{view.classList.remove('projector-obstacle-question-hidden','projector-obstacle-question-exiting');void $('projectorObstacleQuestion').parentElement.offsetWidth;view.classList.add('projector-obstacle-question-entering');projectorObstacleQuestionTimeout=setTimeout(()=>{view.classList.remove('projector-obstacle-question-entering');projectorObstacleQuestionTimeout=null;},800);},2000);}
function syncProjectorObstacleQuestionPresentation(state,previous){const view=$('projectorView'),obstacle=state.roundMode==='obstacle',started=obstacle&&Boolean(state.obstacleStarted);if(!started){clearProjectorObstacleQuestionTimeout();view.classList.remove('projector-obstacle-question-entering','projector-obstacle-question-exiting','projector-obstacle-question-hidden');return;}if(!previous||previous.roundMode!=='obstacle'||!previous.obstacleStarted){clearProjectorObstacleQuestionTimeout();view.classList.remove('projector-obstacle-question-entering','projector-obstacle-question-exiting');view.classList.add('projector-obstacle-question-hidden');}}
function clearProjectorSpeedQuestionTimeout(){if(projectorSpeedQuestionTimeout){clearTimeout(projectorSpeedQuestionTimeout);projectorSpeedQuestionTimeout=null;}}
function syncProjectorSpeedQuestionPresentation(state,previous){const view=$('projectorView');if(state.roundMode!=='speed'){clearProjectorSpeedQuestionTimeout();projectorSpeedMediaReady=false;projectorSpeedQuestionRequested=false;view.classList.remove('projector-speed-question-hidden','projector-speed-question-entering','projector-speed-media-pending');return;}if(!previous||previous.roundMode!=='speed'){clearProjectorSpeedQuestionTimeout();projectorSpeedMediaReady=false;projectorSpeedQuestionRequested=false;view.classList.remove('projector-speed-question-entering');view.classList.add('projector-speed-question-hidden','projector-speed-media-pending');}}
function animateProjectorSpeedQuestion(){if(role!=='projector'||latest?.roundMode!=='speed'||!projectorSpeedMediaReady)return;const view=$('projectorView'),question=$('projectorPlayerQuestionText'),media=$('projectorPlayerQuestionMedia').parentElement;clearProjectorSpeedQuestionTimeout();view.classList.remove('projector-speed-question-entering');view.classList.add('projector-speed-question-hidden');void question.offsetWidth;void media.offsetWidth;view.classList.remove('projector-speed-question-hidden','projector-speed-media-pending');view.classList.add('projector-speed-question-entering');projectorSpeedQuestionTimeout=setTimeout(()=>{view.classList.remove('projector-speed-question-entering');projectorSpeedQuestionTimeout=null;},800);}
function showProjectorSpeedQuestion(){if(role!=='projector'||latest?.roundMode!=='speed')return;projectorSpeedQuestionRequested=true;if(!projectorSpeedMediaReady){$('projectorView').classList.add('projector-speed-question-hidden','projector-speed-media-pending');return;}animateProjectorSpeedQuestion();}
function markProjectorSpeedMediaReady(element){if(role!=='projector'||latest?.roundMode!=='speed'||$('projectorPlayerQuestionMedia').firstElementChild!==element)return;projectorSpeedMediaReady=true;$('projectorView').classList.remove('projector-speed-media-pending');if(projectorSpeedQuestionRequested)animateProjectorSpeedQuestion();}
function startProjectorFinishEntrance(){if(role!=='projector')return;const view=$('projectorView');clearProjectorFinishAnimationTimeout();view.classList.remove('projector-finish-exiting','projector-finish-entering');view.classList.add('projector-finish-hidden');void view.offsetWidth;view.classList.add('projector-finish-entering');projectorFinishAnimationTimeout=setTimeout(()=>{view.classList.remove('projector-finish-entering','projector-finish-hidden');projectorFinishAnimationTimeout=null;},2800);}
function startProjectorFinishExit(){if(role!=='projector')return;const view=$('projectorView'),wasHidden=view.classList.contains('projector-finish-hidden');clearProjectorFinishAnimationTimeout();view.classList.remove('projector-finish-entering');if(wasHidden){view.classList.add('projector-finish-hidden');view.classList.remove('projector-finish-exiting');return;}view.classList.remove('projector-finish-exiting');void view.offsetWidth;view.classList.add('projector-finish-exiting');projectorFinishAnimationTimeout=setTimeout(()=>{view.classList.remove('projector-finish-exiting');view.classList.add('projector-finish-hidden');projectorFinishAnimationTimeout=null;},1800);}
function hideProjectorFinishQuestionPoints(){const label=$('projectorFinishQuestionPoints');if(!label||label.classList.contains('hidden'))return;label.classList.remove('is-entering','is-exiting');void label.offsetWidth;label.classList.add('is-exiting');}
function renderProjectorFinishQuestionPoints(state,previous){const label=$('projectorFinishQuestionPoints');if(!label)return;if(state.roundMode!=='finish'){label.classList.remove('is-entering','is-exiting');label.classList.add('hidden');return;}if(!Number.isInteger(state.finishQuestionIndex))return;label.textContent=Number.isInteger(state.finishQuestionPoints)?`Câu ${state.finishQuestionPoints} điểm`:'Câu ... điểm';const firstQuestion=previous?.roundMode==='finish'&&!Number.isInteger(previous.finishQuestionIndex);if(firstQuestion){label.classList.remove('hidden','is-entering','is-exiting');void label.offsetWidth;label.classList.add('is-entering');}else label.classList.remove('hidden');}
$('projectorFinishQuestionPoints').addEventListener('animationend',event=>{const label=event.currentTarget;if(event.animationName==='projector-finish-question-points-in')label.classList.remove('is-entering');if(event.animationName==='projector-finish-question-points-out'){label.classList.remove('is-exiting');label.classList.add('hidden');}});
function showProjectorFinishStartGraphic(){if(role!=='projector')return;const graphic=$('projectorFinishStartGraphic');if(projectorFinishStartExitTimeout){clearTimeout(projectorFinishStartExitTimeout);projectorFinishStartExitTimeout=null;}renderProjectorFinishStartGraphic();graphic.classList.remove('hidden','projector-finish-starting','projector-finish-start-exiting');void graphic.offsetWidth;graphic.classList.add('projector-finish-starting');}
function hideProjectorFinishStartGraphic(){const graphic=$('projectorFinishStartGraphic');if(!graphic)return;if(projectorFinishStartExitTimeout){clearTimeout(projectorFinishStartExitTimeout);projectorFinishStartExitTimeout=null;}graphic.classList.remove('projector-finish-starting','projector-finish-start-exiting');graphic.classList.add('hidden');}
function scheduleProjectorFinishStartGraphicExit(){const graphic=$('projectorFinishStartGraphic');if(!graphic||graphic.classList.contains('hidden'))return;if(projectorFinishStartExitTimeout)clearTimeout(projectorFinishStartExitTimeout);graphic.classList.remove('projector-finish-start-exiting');void graphic.offsetWidth;graphic.classList.add('projector-finish-start-exiting');projectorFinishStartExitTimeout=setTimeout(()=>{graphic.classList.remove('projector-finish-start-exiting','projector-finish-starting');graphic.classList.add('hidden');projectorFinishStartExitTimeout=null;},2000);}
function renderProjectorFinishStartGraphic(state=latest){const graphic=$('projectorFinishStartGraphic');if(!graphic)return;const selectedPoints=state?.finishQuestionPointsSequence||[],allowForty=Boolean(state?.finishAllowFortyQuestionFour);graphic.querySelectorAll('.projector-finish-point-row').forEach(row=>{const tile=row.querySelector('[data-finish-point-tile]'),isDisabledForty=tile?.dataset.finishPointTile==='40'&&!allowForty;row.classList.toggle('hidden',Boolean(isDisabledForty));});graphic.querySelectorAll('[data-finish-points][data-finish-question]').forEach(marker=>{const question=Number(marker.dataset.finishQuestion),points=Number(marker.dataset.finishPoints);marker.classList.toggle('is-selected',selectedPoints[question-1]===points);});}
async function queueProjectorAudio(type){if(!['buzz','correct','wrong','start','end','opening','blank','vcnv15','tt20','tt30','tt40','speedQuestionOpen','showAnswerVCNV','showAnswerTT',...Object.keys(finishAudioFiles),...Object.keys(hostCueAudioFiles)].includes(type))return;const generation=projectorAudioGeneration;projectorAudioQueue.push(type);if(!projectorAudioBuffers.has(type)){try{await loadProjectorAudio(type);}catch(error){projectorAudioQueue=projectorAudioQueue.filter(item=>item!==type);toast(`Không thể tải âm thanh máy chiếu: ${error.message}`);return;}}if(generation!==projectorAudioGeneration)return;playNextProjectorAudio();}
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
async function unlockProjectorAudio(){if(role!=='projector')return;try{const context=audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());await context.resume();await Promise.all(['buzz','correct','wrong','start','end','opening','vcnv15','tt20','tt30','tt40','speedQuestionOpen','showAnswerVCNV','showAnswerTT',...Object.keys(finishAudioFiles)].map(loadProjectorAudio));projectorAudioReady=true;playNextProjectorAudio();syncProjectorOpeningMusic(latest,true);toast('Âm thanh máy chiếu đã bật.');}catch(error){projectorAudioReady=false;toast(`Không thể bật âm thanh máy chiếu: ${error.message}`);}}
function emitAck(event,data={}){return new Promise(resolve=>socket.emit(event,data,r=>resolve(r||{ok:false,error:'Không nhận được phản hồi từ máy chủ.'})));}
function reportPlayerFocus(){if(role==='player'&&socket.connected)socket.emit('player:focus',{focused:document.visibilityState==='visible'&&document.hasFocus()});}
window.addEventListener('focus',reportPlayerFocus);
window.addEventListener('blur',reportPlayerFocus);
document.addEventListener('visibilitychange',reportPlayerFocus);
document.addEventListener('keydown',event=>{
 if(role!=='host'||$('hostView').classList.contains('hidden')||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
 if(event.repeat)return;
 if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
 const buttons=latest?.roundMode==='finish'?{c:$('finishCorrect'),x:$('finishWrong'),b:$('finishBlank'),ArrowRight:$('nextFinishQuestion'),ArrowLeft:$('previousFinishQuestion')}:latest?.roundMode==='opening'?{ArrowUp:$('openingAnswerCorrect'),ArrowDown:$('openingAnswerIncorrect'),ArrowRight:$('nextOpeningQuestion'),ArrowLeft:$('previousOpeningQuestion'),z:$('startFiveSecondTimer'),b:$('playBlankSound')}:{};
 const button=buttons[event.key.length===1?event.key.toLowerCase():event.key];
 if(!button)return;
 event.preventDefault();
 if(!button.disabled)button.click();
});
$('goHost').onclick=()=>show('hostSetup'); $('goPlayer').onclick=()=>show('playerSetup'); document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show('home'));
$('createRoom').onclick=async()=>{const teams=$('teams').value.split('\n').map(x=>x.trim()).filter(Boolean);const r=await emitAck('host:create',{hostName:$('hostName').value,duration:$('duration').value,teams});if(!r.ok)return toast(r.error);role='host';roomCode=r.code;hostLink=`${location.origin}/?room=${roomCode}`;$('hostCode').textContent=roomCode;show('hostView');render(r.state);renderAnswers([]);await loadDatabase();};
$('hostView').querySelectorAll('[data-host-round]').forEach(button=>button.addEventListener('click',async()=>{
 const data={round:button.dataset.hostRound};
 activeSpeedQuestionSlot=null;
 if(data.round==='obstacle'){hostObstacleRevealed.clear();hostObstacleRowSelected=null;hostObstacleVerdicts={};activeRoundMedia=null;renderHostObstacleBoard();}
 const result=await emitAck('host:round-mode',data);
 if(!result.ok)toast(result.error);
 else{updateHostRoundButtons(data.round);const soundType={opening:'roundStartKD',obstacle:'roundStartVCNV',speed:'roundStartTT',finish:'roundStartVD'}[data.round];if(soundType){const soundResult=await emitAck('host:opening:audio',{type:soundType});if(!soundResult.ok)toast(soundResult.error);}}
}));
$('hostObstaclePicture').addEventListener('click',async event=>{const button=event.target.closest('[data-obstacle-tile]');if(!button)return;const tile=button.dataset.obstacleTile;hostObstacleRevealed.has(tile)?hostObstacleRevealed.delete(tile):hostObstacleRevealed.add(tile);renderHostObstacleBoard();const result=await emitAck('host:obstacle:reveal',{tile,open:hostObstacleRevealed.has(tile)});if(!result.ok)toast(result.error);const soundResult=await emitAck('host:opening:audio',{type:'openPiece'});if(!soundResult.ok)toast(soundResult.error);});
document.querySelectorAll('[data-obstacle-reveal]').forEach(button=>button.addEventListener('click',async()=>{const tile=button.dataset.obstacleReveal;hostObstacleRevealed.has(tile)?hostObstacleRevealed.delete(tile):hostObstacleRevealed.add(tile);renderHostObstacleBoard();const result=await emitAck('host:obstacle:reveal',{tile,open:hostObstacleRevealed.has(tile)});if(!result.ok)toast(result.error);const soundResult=await emitAck('host:opening:audio',{type:'openPiece'});if(!soundResult.ok)toast(soundResult.error);}));
document.querySelectorAll('[data-obstacle-judge]').forEach(button=>button.addEventListener('click',async()=>{const tile=button.dataset.obstacleJudge,verdict=button.dataset.verdict;hostObstacleVerdicts[tile]=verdict;renderHostObstacleBoard();const result=await emitAck('host:obstacle:verdict',{row:Number(tile),verdict});if(!result.ok)toast(result.error);if(verdict==='S'){const soundResult=await emitAck('host:opening:audio',{type:'wrongHN'});if(!soundResult.ok)toast(soundResult.error);}}));
document.querySelectorAll('[data-obstacle-row-reveal]').forEach(button=>button.addEventListener('click',async()=>{
 const row=Number(button.dataset.obstacleRowReveal),entry=row===5?null:obstacleCourse.rows[row-1],question=row===5?obstacleCourse.keywordQuestion:entry?.question,answer=row===5?obstacleCourse.keyword:entry?.answer;
 const soundResult=await emitAck('host:opening:audio',{type:'pickHNCombined'});if(!soundResult.ok)toast(soundResult.error);
 const selectedResult=await emitAck('host:obstacle:row-selected',{row});if(!selectedResult.ok)toast(selectedResult.error);
 if(!question?.trim())return toast(`Chưa có câu hỏi hàng ngang ${row} trong Database.`);
 $('hostQuestionInput').value=question;$('hostAnswerNote').value=answer||'';
 const result=await emitAck('host:question',{question,resetBuzzer:true,obstacleRow:row});if(!result.ok)return toast(result.error);
 hostObstacleRowSelected=row;renderHostObstacleBoard();
}));
$('hostObstacleOpenPicture').addEventListener('click',async()=>{const result=await emitAck('host:obstacle:picture-open');if(!result.ok)toast(result.error);});
$('hostObstacleStart').addEventListener('click',async()=>{const result=await emitAck('host:obstacle:start');if(!result.ok)return toast(result.error);const audioResult=await emitAck('host:opening:audio',{type:'openHN'});if(!audioResult.ok)toast(audioResult.error);});
$('hostObstacleRevealAll').onclick=async()=>{for(let tile=1;tile<=5;tile++)hostObstacleRevealed.add(String(tile));hostObstacleVerdicts=Object.fromEntries([1,2,3,4,5].map(row=>[row,'Đ']));renderHostObstacleBoard();const result=await emitAck('host:obstacle:reveal',{all:true});if(!result.ok)toast(result.error);const soundResult=await emitAck('host:opening:audio',{type:'openAll'});if(!soundResult.ok)toast(soundResult.error);};
document.querySelectorAll('[data-projector-sound]').forEach(button=>button.addEventListener('click',async()=>{const result=await emitAck('host:opening:audio',{type:button.dataset.projectorSound});if(!result.ok)toast(result.error);}));
$('gradeAnswers').onclick=()=>{
 const correctAnswerIds=latestHostAnswers.filter(answer=>selectedHostAnswerIds.has(answer.id)).map(answer=>answer.id);
 emitAck('host:answers:grade',{correctAnswerIds}).then(async result=>{
  if(!result.ok)return toast(result.error);
  for(const grade of result.grades||[]){gradedHostAnswers.set(grade.answerId,grade.correct);const answer=latestHostAnswers.find(item=>item.id===grade.answerId);if(answer){answer.gradedCorrect=grade.correct;answer.pointsAwarded=grade.pointsAwarded;}}
  if(result.obstacleRow&&result.obstacleVerdict){hostObstacleVerdicts[result.obstacleRow]=result.obstacleVerdict;renderHostObstacleBoard();}
  selectedHostAnswerIds.clear();
  renderAnswers(latestHostAnswers);
  const audioResult=await emitAck('host:opening:audio',{type:result.correctCount>0?'correctHN':'wrongHN'});
  if(!audioResult.ok)toast(audioResult.error);
  toast(`Đã cộng điểm cho ${result.correctCount} đáp án đúng.`);
 });
};
$('finishPlayerSelect').addEventListener('change',()=>{$('startFinishRound').disabled=!$('finishPlayerSelect').value;refreshFinishCommitButton();});
$('startFinishRound').onclick=async()=>{const result=await emitAck('host:finish:start',{playerId:$('finishPlayerSelect').value});if(!result.ok)return toast(result.error);$('hostQuestionInput').value='';toast('Đã chọn thí sinh Về đích; chuông của thí sinh này bị khóa.');};
$('finishNshv').onclick=async()=>{const result=await emitAck('host:finish:nshv');if(!result.ok)toast(result.error);};
$('finishBlank').onclick=async()=>{const result=await emitAck('host:opening:audio',{type:'blank'});if(!result.ok)toast(result.error);};
$('finishCorrect').onclick=async()=>{const result=await emitAck('host:finish:judge',{correct:true});if(!result.ok)toast(result.error);};
$('finishWrong').onclick=async()=>{const result=await emitAck('host:finish:judge',{correct:false});if(!result.ok)toast(result.error);};
for(const seconds of [15,20,30])$(`finishTimer${seconds}`).onclick=async()=>{const result=await emitAck('host:finish:timer',{seconds});if(!result.ok)toast(result.error);};
$('finishRoundSelect').addEventListener('change',refreshFinishCommitButton);
$('finishAllowFortyQuestionFour').addEventListener('change',updateFinishQuestionChoices);
document.querySelectorAll('.finish-question-choice-grid input[type="radio"]').forEach(input=>input.addEventListener('change',refreshFinishCommitButton));
updateFinishQuestionChoices();
function updateHostRoundButtons(round){
 $('hostView').querySelectorAll('[data-host-round]').forEach(button=>{
  const active=button.dataset.hostRound===round;
  button.classList.toggle('is-active',active);
  button.setAttribute('aria-pressed',String(active));
 });
 $('hostView').querySelector('.opening-question-layout').classList.toggle('hidden',round!=='opening');
 $('hostView').querySelector('.finish-round-layout').classList.toggle('hidden',round!=='finish');
 $('hostView').querySelector('.intro-cue-grid').classList.toggle('hidden',round!=='intro');
 $('hostObstacleReveal').classList.toggle('hidden',round!=='obstacle');
 $('hostView').querySelector('.host-future-panel').classList.toggle('finish-round-active',round==='finish');
}
function renderHostObstacleBoard(){
 const picture=$('hostObstaclePicture');if(!picture)return;picture.replaceChildren();
 if(hostObstacleMediaObjectUrl){URL.revokeObjectURL(hostObstacleMediaObjectUrl);hostObstacleMediaObjectUrl=null;}
 if(activeRoundMedia?.data){
  hostObstacleMediaObjectUrl=URL.createObjectURL(new Blob([activeRoundMedia.data],{type:activeRoundMedia.type}));
  const media=document.createElement(activeRoundMedia.type.startsWith('video/')?'video':'img');media.src=hostObstacleMediaObjectUrl;media.alt=activeRoundMedia.name||'Ảnh Vượt chướng ngại vật';
  if(media instanceof HTMLVideoElement){media.muted=true;media.loop=true;media.autoplay=true;media.playsInline=true;media.play().catch(()=>{});}
  picture.append(media);
 }else{const empty=document.createElement('span');empty.textContent='Chưa có ảnh VCNV';picture.append(empty);}
 const tiles=[
  {id:'1',shape:'obstacle-mask-top-left',position:'top-left'},
  {id:'2',shape:'obstacle-mask-top-right',position:'top-right'},
  {id:'3',shape:'obstacle-mask-bottom-right',position:'bottom-right'},
  {id:'4',shape:'obstacle-mask-bottom-left',position:'bottom-left'},
  {id:'5',shape:'obstacle-mask-center',position:'center'}
 ];
 for(const tile of tiles){if(hostObstacleRevealed.has(tile.id))continue;const button=document.createElement('button');button.type='button';button.className=`obstacle-mask ${tile.shape}`;button.dataset.obstacleTile=tile.id;button.setAttribute('aria-label',`Mở phần ảnh ${tile.id}`);const label=document.createElement('span');label.className=`obstacle-mask-label ${tile.position}`;label.textContent=tile.id;button.append(label);picture.append(button);}
 $('hostObstacleOpenPicture').classList.toggle('is-picture-open',Boolean(latest?.obstaclePictureOpen));
 document.querySelectorAll('[data-obstacle-reveal]').forEach(button=>button.classList.toggle('is-revealed',hostObstacleRevealed.has(button.dataset.obstacleReveal)));
 document.querySelectorAll('[data-obstacle-judge]').forEach(button=>{const row=button.dataset.obstacleJudge,active=hostObstacleVerdicts[row]===button.dataset.verdict;button.classList.toggle('is-active',active);button.classList.toggle('is-incorrect',active&&button.dataset.verdict==='S');button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',`HN ${row}: ${button.dataset.verdict==='Đ'?'Đúng':'Sai'}`);});
 document.querySelectorAll('[data-obstacle-row-reveal]').forEach(button=>{const row=Number(button.dataset.obstacleRowReveal),answer=row===5?obstacleCourse.keyword:obstacleCourse.rows[row-1]?.answer||'',displayAnswer=splitGraphemes(answer).join('').trim().toLocaleUpperCase(),active=row===hostObstacleRowSelected;button.textContent=`${row} (${obstacleCharacterCount(answer)}) (${displayAnswer||'—'})`;button.setAttribute('aria-label',`HN ${row}, ${obstacleCharacterCount(answer)} ký tự: ${displayAnswer||'chưa có đáp án'}`);button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
}
function refreshFinishControls(state){
 const select=$('finishPlayerSelect'),selected=select.value;
 const options=[['','Không chọn thí sinh'],...(state?.players||[]).map(player=>[player.id,`${player.name} · ${player.team}`])];
 if(select.options.length!==options.length||options.some(([value,label],index)=>select.options[index]?.value!==value||select.options[index]?.textContent!==label)){
  select.replaceChildren(...options.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
 }
 select.value=options.some(([value])=>value===selected)?selected:'';
 $('startFinishRound').disabled=!select.value;
 refreshFinishCommitButton();
}
function updateFinishQuestionChoices(){
 const allowFortyQuestionFour=$('finishAllowFortyQuestionFour').checked;
 $('hostView').querySelectorAll('.finish-question-choice-grid input[type="radio"]').forEach(input=>{
  input.disabled=!allowFortyQuestionFour&&(input.value==='40'||input.name==='finish-question-4');
  if(input.disabled)input.checked=false;
 });
 refreshFinishCommitButton();
}
function getFinishQuestionPoints(){
 return [1,2,3].map(number=>{
  const selected=$('hostView').querySelector(`input[name="finish-question-${number}"]:checked`);
  return selected?Number(selected.value):null;
 });
}
function refreshFinishCommitButton(){
 const points=getFinishQuestionPoints();
 $('waitFinishRound').disabled=$('finishAllowFortyQuestionFour').checked||
  !$('finishRoundSelect').value||!$('finishPlayerSelect').value||
  points.length!==3||points.some(value=>value!==20&&value!==30);
}
function resetFinishQuestionSelection(){
 document.querySelectorAll('.finish-question-choice-grid input[type="radio"]').forEach(input=>{input.checked=false;});
 $('finishRoundSelect').value='';
 $('finishPlayerSelect').value='';
 $('startFinishRound').disabled=true;
 updateFinishQuestionChoices();
 refreshFinishCommitButton();
}
function updateFinishQuestionNavigation(state){
 const count=state?.finishQuestionCount||0,index=state?.finishQuestionIndex;
 $('nextFinishQuestion').disabled=!count||(Number.isInteger(index)&&index>=count-1);
 $('previousFinishQuestion').disabled=!count||!Number.isInteger(index)||index<=0;
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
openDatabase.onclick=()=>{show('hostDatabase');loadDatabase();};
closeDatabase.onclick=()=>show('hostView');
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
 for(let cellIndex=0;cellIndex<15;cellIndex++){
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
   else if(event.key.length===1&&cellIndex<14&&!event.ctrlKey&&!event.metaKey&&!event.altKey){setTimeout(()=>{if(input.value)cells.querySelectorAll('input')[cellIndex+1].focus();},0);}
  });
  input.addEventListener('change',()=>saveObstacleCourse({row:rowIndex,answer:readObstacleAnswer(rowElement),answerCells:readObstacleAnswerCells(rowElement)}));
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
$('openingStartSound').onclick=async()=>{const result=await emitAck('host:opening:audio',{type:'start'});if(!result.ok)return toast(result.error);$('hostQuestionInput').value='';};
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
$('waitFinishRound').onclick=async()=>{
 const result=await emitAck('host:finish:commit',{
  round:$('finishRoundSelect').value===''?null:Number($('finishRoundSelect').value),
  playerId:$('finishPlayerSelect').value,
  points:getFinishQuestionPoints(),
  allowFortyQuestionFour:$('finishAllowFortyQuestionFour').checked
 });
 if(!result.ok)return toast(result.error);
 $('hostAnswerNote').value='';
 toast('Đã chốt 3 câu. Nhấn NextQs để hiển thị câu đầu tiên.');
};
$('nextFinishQuestion').onclick=()=>navigateFinishQuestion('next');
$('previousFinishQuestion').onclick=()=>navigateFinishQuestion('previous');
async function navigateFinishQuestion(direction){
 const result=await emitAck('host:finish:navigate',{direction});
 if(!result.ok)return toast(result.error);
 $('hostAnswerNote').value=result.answer||'';
}
$('endFinishRound').onclick=async()=>{
 const result=await emitAck('host:finish:end');
 if(!result.ok)return toast(result.error);
 resetFinishQuestionSelection();
 $('hostAnswerNote').value='';
};
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
 const questionResult=await emitAck('host:question',{question:slot.prompt,resetBuzzer:true,clearAnswers:true});
 if(!questionResult.ok){activeSpeedQuestionSlot=null;$('hostAnswerNote').value='';return toast(questionResult.error);}
 selectedHostAnswerIds.clear();gradedHostAnswers.clear();resetAnswerRevealControl();
 const audioResult=await emitAck('host:opening:audio',{type:'speedQuestionOpen'});
 if(!audioResult.ok)toast(audioResult.error);
};
$('joinCode').addEventListener('input',async()=>{const code=$('joinCode').value.trim().toUpperCase();if(code.length<6)return;const r=await emitAck('room:peek',{code});if(r.ok)fillTeams(r.teams);});
// Team list is sent by the server through a lightweight public lookup event.
socket.on('room:teams',({teams})=>fillTeams(teams));
socket.on('player:kicked',()=>{if(role!=='player')return;role=null;roomCode=null;myId=null;myTeam=null;latest=null;$('joinCode').value='';$('playerTeam').innerHTML='<option value="">Đợi tải danh sách đội…</option>';show('playerSetup');toast('Bạn đã bị mời khỏi phòng thi');});
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
$('independentReset').onclick=async()=>{const r=await emitAck('host:independent:reset');if(!r.ok)return toast(r.error);selectedHostAnswerIds.clear();gradedHostAnswers.clear();resetAnswerRevealControl();};
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
function resetAnswerRevealControl(){const button=$('revealLatestAnswers');button.dataset.projectorOpen='false';button.textContent='HIỆN ĐÁP ÁN';button.classList.remove('is-answer-reveal-open');}
socket.on('player:answer:reveal',({answers}={})=>{if(!['player','projector'].includes(role)||!Array.isArray(answers))return;const list=$('revealedAnswers');list.replaceChildren();if(!answers.length){const empty=document.createElement('p');empty.className='revealed-answers-empty';empty.textContent='Chưa có thí sinh gửi câu trả lời.';list.append(empty);}else{answers.forEach(item=>{if(!item||typeof item.name!=='string'||typeof item.team!=='string'||typeof item.answer!=='string'||!Number.isFinite(item.elapsedMs))return;const entry=document.createElement('article');entry.className='revealed-answer';const heading=document.createElement('div');heading.className='revealed-answer-heading';const player=document.createElement('strong');player.textContent=`${item.name} · ${item.team}`;const time=document.createElement('time');time.textContent=formatElapsed(item.elapsedMs);heading.append(player,time);const answer=document.createElement('p');answer.textContent=item.answer;entry.append(heading,answer);list.append(entry);});} $('answerRevealDialog').showModal();});
socket.on('player:answer:reveal',({answers}={})=>{if(role!=='projector'||!Array.isArray(answers))return;[...$('revealedAnswers').querySelectorAll('.revealed-answer')].forEach((card,index)=>{const item=answers[index];if(!item)return;card.dataset.answerId=item.id||'';card.classList.toggle('incorrect',item.gradedCorrect===false);});});
socket.on('answers:graded',({grades}={})=>{if(role!=='projector'||!Array.isArray(grades))return;const cards=[...$('revealedAnswers').querySelectorAll('.revealed-answer')];for(const grade of grades){const card=cards.find(item=>item.dataset.answerId===grade.answerId);if(card)card.classList.toggle('incorrect',grade.correct===false);}});
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
let latestHostAnswers=[];
socket.on('answers:update',answers=>{if(!Array.isArray(answers)||answers.length===0){selectedHostAnswerIds.clear();gradedHostAnswers.clear();resetAnswerRevealControl();}renderAnswers(answers);});
socket.on('projector:volume',({volume}={})=>{setProjectorVolume(volume);if(latest&&Number.isFinite(volume))latest.projectorVolume=volume;});
function renderAnswers(answers=[]){const latestByPlayer=new Map();for(const a of answers){const old=latestByPlayer.get(a.playerId);if(!old||a.submittedAt>=old.submittedAt)latestByPlayer.set(a.playerId,a);}latestHostAnswers=[...latestByPlayer.values()].sort((a,b)=>a.elapsedMs-b.elapsedMs);$('answerCount').textContent=`${latestHostAnswers.length} thí sinh đã trả lời`;$('gradeAnswers').disabled=!latestHostAnswers.length;$('hostAnswers').replaceChildren();if(!latestHostAnswers.length){$('hostAnswers').innerHTML='<p class="muted">Chưa có câu trả lời.</p>';return;}latestHostAnswers.forEach(a=>{const card=document.createElement('article');card.className='answercard';card.dataset.answerId=a.id;const answerId=a.id;const checkboxLabel=document.createElement('label');checkboxLabel.className='answer-select-label';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='answer-select';checkbox.setAttribute('aria-label',`Chọn đáp án của ${a.name}`);checkbox.checked=selectedHostAnswerIds.has(answerId);checkbox.onchange=()=>{if(checkbox.checked)selectedHostAnswerIds.add(answerId);else selectedHostAnswerIds.delete(answerId);};checkboxLabel.append(checkbox);const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${a.name} · ${a.team}`;const time=document.createElement('time');time.textContent=formatElapsed(a.elapsedMs);top.append(who,time);const body=document.createElement('p');body.textContent=a.answer;card.append(checkboxLabel,top,body);if(gradedHostAnswers.has(answerId)){const status=document.createElement('span');const correct=gradedHostAnswers.get(answerId);status.className=`answer-grade-status ${correct?'correct':'incorrect'}`;status.textContent=correct?'ĐÚNG':'SAI';card.classList.add(correct?'answercard-correct':'answercard-incorrect');card.append(status);} $('hostAnswers').append(card);});}
function renderAnswers(answers=[]){const latestByPlayer=new Map();for(const answer of answers){const previous=latestByPlayer.get(answer.playerId);if(!previous||answer.submittedAt>=previous.submittedAt)latestByPlayer.set(answer.playerId,answer);}latestHostAnswers=[...latestByPlayer.values()].sort((a,b)=>a.elapsedMs-b.elapsedMs||a.submittedAt-b.submittedAt);$('answerCount').textContent=`${latestHostAnswers.length} thí sinh đã trả lời`;$('gradeAnswers').disabled=!['obstacle','speed'].includes(latest?.roundMode)||!latestHostAnswers.some(answer=>typeof answer.gradedCorrect!=='boolean');$('hostAnswers').replaceChildren();if(!latestHostAnswers.length){$('hostAnswers').innerHTML='<p class="muted">Chưa có câu trả lời.</p>';return;}for(const answer of latestHostAnswers){const card=document.createElement('article');card.className='answercard';card.dataset.answerId=answer.id;if(typeof answer.gradedCorrect==='boolean')gradedHostAnswers.set(answer.id,answer.gradedCorrect);const checkboxLabel=document.createElement('label');checkboxLabel.className='answer-select-label';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='answer-select';checkbox.disabled=typeof answer.gradedCorrect==='boolean';checkbox.setAttribute('aria-label',`Chọn đáp án của ${answer.name}`);checkbox.checked=selectedHostAnswerIds.has(answer.id);checkbox.onchange=()=>{if(checkbox.checked)selectedHostAnswerIds.add(answer.id);else selectedHostAnswerIds.delete(answer.id);};checkboxLabel.append(checkbox);const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${answer.name} · ${answer.team}`;const time=document.createElement('time');time.textContent=formatElapsed(answer.elapsedMs);top.append(who,time);const body=document.createElement('p');body.textContent=answer.answer;card.append(checkboxLabel,top,body);if(gradedHostAnswers.has(answer.id)){const correct=gradedHostAnswers.get(answer.id),status=document.createElement('span');status.className=`answer-grade-status ${correct?'correct':'incorrect'}`;status.textContent=correct?`ĐÚNG (+${answer.pointsAwarded||0})`:'SAI';card.classList.add(correct?'answercard-correct':'answercard-incorrect');card.append(status);} $('hostAnswers').append(card);}}
function renderBuzzes(buzzes=[]){if(!$('hostBuzzes'))return;$('buzzCount').textContent=`${buzzes.length} lượt`;$('hostBuzzes').innerHTML='';if(!buzzes.length){$('hostBuzzes').innerHTML='<p class="muted">Chưa có thí sinh bấm chuông.</p>';return;}[...buzzes].sort((a,b)=>a.elapsedMs-b.elapsedMs).forEach((b,i)=>{const card=document.createElement('article');card.className='answercard';const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${i+1}. ${b.name} · ${b.team}`;const time=document.createElement('time');time.textContent=formatElapsed(b.elapsedMs);top.append(who,time);card.append(top);$('hostBuzzes').append(card);});}
function queueNewProjectorBuzzes(state,previous){if(role!=='projector'||!previous)return;if(state.roundMode==='obstacle'){if(previous.roundMode==='obstacle'){const oldBuzzIds=new Set((previous.buzzes||[]).map(buzz=>buzz.id));for(const buzz of state.buzzes||[])if(!oldBuzzIds.has(buzz.id))queueProjectorAudio('buzzCNV');}return;}if(state.buzzerAlwaysOpen&&!(previous.buzzes||[]).length&&(state.buzzes||[]).length)queueProjectorBuzz();else if(!state.buzzerAlwaysOpen&&!previous.buzzerAlwaysOpen&&state.winnerId&&state.winnerId!==previous.winnerId)queueProjectorBuzz();}
function renderProjectorObstacleBuzzes(state){const panel=$('projectorObstacleBuzzes'),buzzes=state.obstacleBuzzOrder||[];panel.replaceChildren();panel.classList.toggle('hidden',!buzzes.length);buzzes.forEach(buzz=>{const entry=document.createElement('div');entry.className='projector-obstacle-buzz-entry';entry.textContent=buzz.name;entry.title=buzz.name;panel.append(entry);});}
socket.on('projector:audio',({type}={})=>{if(role!=='projector')return;if(type==='stopAllSFX'){stopAllProjectorSfx();return;}if(type==='start')startProjectorOpeningEntrance();if(type==='end')startProjectorOpeningExit();if(type==='startVDCombined')showProjectorFinishStartGraphic();if(type==='speedQuestionOpen')showProjectorSpeedQuestion();if(type==='showAnswerVCNV'&&latest?.roundMode==='obstacle')hideProjectorObstacleQuestion();if(['correct','wrong','start','end','opening','blank','vcnv15','tt20','tt30','tt40','speedQuestionOpen','showAnswerVCNV','showAnswerTT',...Object.keys(finishAudioFiles),...Object.keys(hostCueAudioFiles)].includes(type))queueProjectorAudio(type);});
socket.on('projector:finish:presentation',({action}={})=>{if(role!=='projector')return;if(action==='commit'){startProjectorFinishEntrance();scheduleProjectorFinishStartGraphicExit();}if(action==='end'){startProjectorFinishExit();hideProjectorFinishStartGraphic();hideProjectorFinishQuestionPoints();}});
socket.on('projector:obstacle:answers',({rows,verdicts}={})=>{if(role!=='projector'||!Array.isArray(rows))return;projectorObstacleAnswerCells=Array.from({length:4},(_,row)=>Array.from({length:15},(_,cell)=>String(rows[row]?.[cell]||'')));projectorObstacleVerdicts=verdicts&&typeof verdicts==='object'?verdicts:{};if(latest?.roundMode==='obstacle')renderProjectorObstacle(latest);});
socket.on('projector:obstacle:verdict',({row,verdict}={})=>{if(role!=='projector'||!Number.isInteger(row))return;projectorObstacleVerdicts[row]=verdict;if(verdict==='S')hideProjectorObstacleQuestion();if(latest?.roundMode==='obstacle')renderProjectorObstacle(latest);});
socket.on('projector:obstacle:question-presentation',({action}={})=>{if(role==='projector'&&action==='show')scheduleProjectorObstacleQuestionEntrance();});
function renderBase(state){const previous=latest;if(!state)return;queueNewProjectorBuzzes(state,previous);latest=state;if(role==='host'&&$('finishNshv')){$('finishNshv').classList.toggle('finish-nshv-active',Boolean(state.finishNshv));$('finishNshv').setAttribute('aria-pressed',String(Boolean(state.finishNshv)));}if(Number.isFinite(state.projectorVolume))setProjectorVolume(state.projectorVolume);if(role==='projector')syncProjectorOpeningMusic(state);if(role==='host'&&!$('hostQuestionInput').matches(':focus'))$('hostQuestionInput').value=state.question||'';if(role==='projector'){syncProjectorObstacleQuestionPresentation(state,previous);syncProjectorSpeedQuestionPresentation(state,previous);renderProjector(state,previous);updateTimer();return;}const names={waiting:'ĐANG CHỜ',playing:'CHUÔNG ĐANG MỞ',won:'ĐÃ CÓ NGƯỜI BẤM',locked:'ĐÃ KHÓA',timeout:'HẾT THỜI GIAN'};const winner=state.players.find(p=>p.id===state.winnerId);
if(role==='host'){$('hostStatus').textContent=names[state.status]||state.status;$('hostStatus').className='status '+(state.status==='playing'?'live':state.status==='won'?'won':'');$('hostWinner').classList.add('hidden');$('hostWinner').textContent='';$('alwaysOpen').checked=Boolean(state.buzzerAlwaysOpen);$('playerCount').textContent=`${state.players.length} người`;renderHostPlayers(state.players,state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId,state);renderBuzzes(state.buzzes||[]);$('startRoundDelayed').disabled=Boolean(state.buzzerCountdownDeadline);}
if(role==='player'){const wasAnswering=Boolean(previous&&previous.independentTimer&&previous.independentTimer.running&&previous.independentTimer.remainingMs>0);const isAnswering=Boolean(state.independentTimer&&state.independentTimer.running&&state.independentTimer.remainingMs>0);if(isAnswering&&!wasAnswering){$('answerInput').value='';$('answerInput').disabled=false;setTimeout(()=>$('answerInput').focus(),0);} $('playerStatus').textContent=names[state.status]||state.status;$('playerStatus').className='status '+(state.status==='playing'?'live':state.status==='won'?'won':'');const me=state.players.find(p=>p.id===myId);$('myScore').textContent=me?me.score:0;if(me&&me.latestAnswer){$('lastAnswerText').textContent=me.latestAnswer.answer;$('lastAnswerTime').textContent=`Đã gửi lúc ${formatElapsed(me.latestAnswer.elapsedMs)}`;}const canBuzz=state.status==='playing'&&!state.buzzerCountdownDeadline&&!(state.roundMode==='finish'&&state.finishPlayerId===myId)&&(state.buzzerAlwaysOpen?!Boolean(me&&me.buzzedAt):!state.winnerId);$('buzzButton').disabled=!canBuzz;$('buzzButton').classList.toggle('ready',canBuzz);$('buzzButton').classList.toggle('pressed',state.buzzerAlwaysOpen?Boolean(me&&me.buzzedAt):state.winnerId===myId);const canSubmitAnswer=isAnswering;$('answerInput').disabled=!canSubmitAnswer;$('submitAnswer').disabled=!canSubmitAnswer;$('answerMessage').textContent=canSubmitAnswer?'Bạn có thể gửi nhiều câu trả lời cho đến khi hết giờ. Nhấn Enter để gửi nhanh (Shift + Enter để xuống dòng).':'Chờ Host bắt đầu hoặc tiếp tục thời gian trả lời...';$('answerMessage').className='muted';$('playerMessage').textContent=state.buzzerCountdownDeadline?'Chuông sẽ mở sau khi đếm ngược kết thúc.':state.buzzerAlwaysOpen&&state.status==='playing'?(me&&me.buzzedAt?'Bạn đã bấm chuông. Hãy chờ Host!':'Chuông luôn mở – mỗi thí sinh được bấm một lần!'):winner?(winner.id===myId?'Bạn đã bấm chuông đầu tiên!':`${winner.name} đã bấm chuông trước.`):state.status==='playing'?'Chuông đã mở – hãy bấm thật nhanh!':state.status==='timeout'?'Đã hết thời gian.':state.status==='locked'?'Chuông đã khóa. Ô trả lời hoạt động theo đồng hồ riêng.':'Chờ Host mở chuông…';$('playerScoreboard').innerHTML='';const fastestId=state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId;[...state.players].sort((a,b)=>b.score-a.score).forEach(p=>$('playerScoreboard').append(scoreRow(p,false,p.id===fastestId)));}
if((lastStatus==='playing'||lastStatus==='locked')&&state.status==='won')sound('win');if(state.status==='playing'&&lastStatus!=='playing')sound('open');lastStatus=state.status;updateTimer();updateIndependentTimer();}
function render(state){
 renderBase(state);
 if(!state)return;
 if(role==='player')document.body.classList.toggle('player-opening-individual-spotlight',state.roundMode==='opening'&&Boolean(state.spotlightPlayerId)&&state.spotlightRound!=='Lượt chung');
 if(role==='projector'){
  const opening=state.roundMode==='opening',view=$('projectorView');
  if(opening&&!projectorOpeningPresentationActive){projectorOpeningPresentationActive=true;clearProjectorOpeningAnimationTimeout();view.classList.remove('projector-opening-entering','projector-opening-exiting');view.classList.add('projector-opening-hidden');}
  else if(!opening){projectorOpeningPresentationActive=false;clearProjectorOpeningAnimationTimeout();view.classList.remove('projector-opening-hidden','projector-opening-entering','projector-opening-exiting');}
  const finish=state.roundMode==='finish';
  if(finish&&!projectorFinishPresentationActive){projectorFinishPresentationActive=true;clearProjectorFinishAnimationTimeout();view.classList.remove('projector-finish-entering','projector-finish-exiting');if(state.finishQuestionCount)view.classList.remove('projector-finish-hidden');else view.classList.add('projector-finish-hidden');}
  else if(!finish){projectorFinishPresentationActive=false;clearProjectorFinishAnimationTimeout();view.classList.remove('projector-finish-hidden','projector-finish-entering','projector-finish-exiting');hideProjectorFinishStartGraphic();}
 }
 if(role==='projector'){const obstacle=state.roundMode==='obstacle',speed=state.roundMode==='speed',individualOpening=state.roundMode==='opening'&&Boolean(state.spotlightPlayerId)&&state.spotlightRound!=='Lượt chung',started=Boolean(state.obstacleStarted);$('projectorView').classList.toggle('projector-speed-mode',speed);$('projectorView').classList.toggle('projector-opening-individual-spotlight',individualOpening);$('projectorView').classList.toggle('projector-obstacle-mode',obstacle);$('projectorView').classList.toggle('projector-obstacle-started',obstacle&&started);$('projectorObstacleView').classList.toggle('hidden',!obstacle||!started);renderProjectorFinishStartGraphic(state);if(obstacle&&started){renderProjectorObstacle(state);renderProjectorObstacleBuzzes(state);}}
 if(role==='player'&&state.roundMode==='obstacle'){const me=state.players.find(player=>player.id===myId),canBuzz=Boolean(state.obstacleStarted&&me&&!me.obstacleBuzzUsed),canAnswer=Boolean(state.independentTimer?.running&&state.independentTimer.remainingMs>0&&me&&!me.obstacleBuzzUsed);$('buzzButton').disabled=!canBuzz;$('buzzButton').classList.toggle('ready',canBuzz);$('buzzButton').classList.toggle('pressed',Boolean(me?.obstacleBuzzed));$('answerInput').disabled=!canAnswer;$('submitAnswer').disabled=!canAnswer;}
 if(role==='host'){$('hostObstacleOpenPicture').classList.toggle('is-picture-open',Boolean(state.obstaclePictureOpen));const revealed=new Set(state.obstaclePictureRevealed||[]);if(revealed.size!==hostObstacleRevealed.size||[...revealed].some(tile=>!hostObstacleRevealed.has(tile))){hostObstacleRevealed=revealed;renderHostObstacleBoard();}}
 if(role==='player'){renderPlayerQuestion(state);const player=state.players.find(item=>item.id===myId);if(!player?.latestAnswer){$('lastAnswerText').textContent='';$('lastAnswerTime').textContent='';}}
 if(role==='host'){updateHostRoundButtons(state.roundMode||'opening');refreshFinishControls(state);updateFinishQuestionNavigation(state);$('finishQuestionPointsDisplay').textContent=Number.isInteger(state.finishQuestionPoints)?`Câu ${state.finishQuestionPoints} điểm`:'Câu ... điểm';$('gradeAnswers').disabled=!['obstacle','speed'].includes(state.roundMode)||!latestHostAnswers.some(answer=>typeof answer.gradedCorrect!=='boolean');}
 if(role==='host')setOpeningNavigationEnabled(Boolean(state.openingQuestionRound&&Number.isInteger(state.openingQuestionIndex)));
 if(role==='host'){refreshSpotlightControls(state);syncHostOpeningAnswer(state);applySpotlightClass($('hostPlayers'),state.players);applyFinishSelectedClass($('hostPlayers'),state.players);}
 else if(role==='player'){const players=[...state.players].sort((a,b)=>b.score-a.score),individualOpening=state.roundMode==='opening'&&Boolean(state.spotlightPlayerId)&&state.spotlightRound!=='Lượt chung';applySpotlightClass($('playerScoreboard'),players,individualOpening?state.spotlightPlayerId:undefined);applyFinishSelectedClass($('playerScoreboard'),players);}
 else if(role==='projector'){const players=[...state.players].sort((a,b)=>b.score-a.score),individualOpening=state.roundMode==='opening'&&Boolean(state.spotlightPlayerId)&&state.spotlightRound!=='Lượt chung';applySpotlightClass($('projectorScoreboard'),players,individualOpening?state.spotlightPlayerId:undefined);applySpotlightClass($('projectorPlayerScoreboard'),players,individualOpening?state.spotlightPlayerId:undefined);applyFinishSelectedClass($('projectorScoreboard'),players);applyFinishSelectedClass($('projectorPlayerScoreboard'),players);}
}
function applyFinishSelectedClass(container,players){container.querySelectorAll('.playerrow,.projector-player').forEach((row,index)=>row.classList.toggle('finish-selected-player',players[index]?.id===latest?.finishPlayerId));}
function renderPlayerQuestion(state){
 const projector=role==='projector';
 const display=$(projector?'projectorPlayerQuestion':'questionDisplay'),text=$(projector?'projectorPlayerQuestionText':'questionDisplayText'),media=$(projector?'projectorPlayerQuestionMedia':'questionDisplayMedia');
 const mediaRound=state.roundMode==='speed'&&Boolean(activeRoundMedia);
 if(projector){const view=$('projectorView');if(state.roundMode==='speed'&&!activeRoundMedia){projectorSpeedMediaReady=false;projectorSpeedQuestionRequested=false;view.classList.add('projector-speed-media-pending');}else if(state.roundMode!=='speed'){projectorSpeedMediaReady=false;projectorSpeedQuestionRequested=false;view.classList.remove('projector-speed-media-pending');}}
 display.classList.toggle('round-media-active',mediaRound);
 text.textContent=state.question||'';
 if(!projector)requestAnimationFrame(fitPlayerQuestion);
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
 if(projector&&state.roundMode==='speed'){projectorSpeedMediaReady=false;$('projectorView').classList.add('projector-speed-media-pending');}
 media.querySelector('video')?.pause();
 media.replaceChildren();
 if(activeRoundMediaObjectUrl)URL.revokeObjectURL(activeRoundMediaObjectUrl);
 activeRoundMediaObjectUrl=URL.createObjectURL(new Blob([activeRoundMedia.data],{type:activeRoundMedia.type}));
 const element=document.createElement(activeRoundMedia.type.startsWith('video/')?'video':'img');
 element.dataset.mediaKey=mediaKey;
 element.src=activeRoundMediaObjectUrl;
 if(projector&&state.roundMode==='speed'){element.addEventListener('load',()=>markProjectorSpeedMediaReady(element),{once:true});element.addEventListener('loadeddata',()=>markProjectorSpeedMediaReady(element),{once:true});}
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
 if(projector&&state.roundMode==='speed'&&element instanceof HTMLImageElement&&element.complete&&element.naturalWidth>0)markProjectorSpeedMediaReady(element);
 if(projector&&state.roundMode==='speed'&&element instanceof HTMLVideoElement&&element.readyState>=2)markProjectorSpeedMediaReady(element);
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
 if(role==='host'){
  if(latest?.roundMode!=='obstacle')return;
  activeRoundMedia=media&&typeof media.data!=='undefined'?media:null;
  activeRoundMediaVersion++;
  renderHostObstacleBoard();
  return;
 }
 if(!['player','projector'].includes(role))return;
 activeRoundMedia=media&&typeof media.data!=='undefined'?media:null;
 activeRoundMediaVersion++;
 if(role==='projector'&&latest?.roundMode==='speed'){projectorSpeedMediaReady=false;projectorSpeedQuestionRequested=false;$('projectorView').classList.add('projector-speed-media-pending','projector-speed-question-hidden');}
 if(latest){renderPlayerQuestion(latest);if(role==='projector'&&latest.roundMode==='obstacle')renderProjectorObstacle(latest);}
});
socket.on('host:database:questions:update',questions=>{
 if(role!=='host'||!Array.isArray(questions))return;
 databaseQuestions=questions;
 refreshSpotlightControls(latest);
 syncHostOpeningAnswer(latest);
});
socket.on('host:finish:answer',({answer}={})=>{
 if(role==='host'&&typeof answer==='string')$('hostAnswerNote').value=answer;
});
socket.on('host:database:speed-questions:update',questions=>{
 if(role!=='host'||!Array.isArray(questions))return;
 speedQuestionSlots=questions;
 renderSpeedQuestionSelect();
 syncHostOpeningAnswer(latest);
});
function setOpeningNavigationEnabled(enabled){$('nextOpeningQuestion').disabled=!enabled;$('previousOpeningQuestion').disabled=!enabled;}
function applySpotlightClass(container,players,forcedHighlightedId){const highlightedId=forcedHighlightedId===undefined?(latest?.buzzerAlwaysOpen?fastestBuzzerId(latest.buzzes):latest?.spotlightPlayerId):forcedHighlightedId;[...container.querySelectorAll('.playerrow,.projector-player')].forEach((row,index)=>row.classList.toggle('spotlight-player',players[index]?.id===highlightedId));}
function syncHostOpeningAnswer(state){
 if(role!=='host')return;
 if(state?.roundMode==='finish'){
  if(!Number.isInteger(state.finishQuestionIndex))$('hostAnswerNote').value='';
  return;
 }
 if(activeSpeedQuestionSlot!==null&&!state?.openingQuestionRound){
  $('hostAnswerNote').value=speedQuestionSlots[activeSpeedQuestionSlot]?.answer||'';
  return;
 }
 if(!state?.openingQuestionRound||!Number.isInteger(state.openingQuestionIndex)){ $('hostAnswerNote').value=''; return; }
 const questions=databaseQuestions.filter(question=>question.round===state.openingQuestionRound).sort((a,b)=>(a.sourceRow||0)-(b.sourceRow||0));
 $('hostAnswerNote').value=questions[state.openingQuestionIndex]?.answer||'';
}
function renderProjectorObstacle(state){const rows=$('projectorObstacleRows'),picture=$('projectorObstaclePicture'),pictureOpen=Boolean(state.obstaclePictureOpen);picture.classList.toggle('hidden',!pictureOpen);picture.setAttribute('aria-hidden',String(!pictureOpen));rows.classList.toggle('hidden',pictureOpen);$('projectorObstacleQuestion').parentElement.classList.toggle('hidden',pictureOpen);if(pictureOpen)renderProjectorObstaclePicture();if(rows.children.length!==4){rows.replaceChildren();for(let row=0;row<4;row++){const line=document.createElement('div');line.className='projector-obstacle-row';for(let cell=0;cell<15;cell++){const circle=document.createElement('span');circle.className='projector-obstacle-circle';line.append(circle);}rows.append(line);}}[...rows.children].forEach((line,rowIndex)=>[...line.children].forEach((circle,cellIndex)=>{const character=projectorObstacleAnswerCells[rowIndex]?.[cellIndex]||'',verdict=projectorObstacleVerdicts[rowIndex+1];circle.textContent=character;circle.classList.toggle('is-empty',!character.trim());circle.classList.toggle('is-revealed',verdict==='Đ');circle.classList.toggle('is-wrong',verdict==='S');circle.classList.toggle('is-selected',state.obstacleSelectedRow===rowIndex+1&&verdict!=='Đ'&&verdict!=='S');}));const question=$('projectorObstacleQuestion');question.textContent=state.question||'';if(!pictureOpen)requestAnimationFrame(fitProjectorObstacleQuestion);}
function renderProjectorObstaclePicture(state=latest){const picture=$('projectorObstaclePicture'),revealed=[...(state?.obstaclePictureRevealed||[])].sort().join(','),mediaKey=`${activeRoundMedia?activeRoundMediaVersion:'none'}:${revealed}`;if(picture.dataset.mediaKey!==mediaKey){picture.replaceChildren();if(projectorObstacleMediaObjectUrl){URL.revokeObjectURL(projectorObstacleMediaObjectUrl);projectorObstacleMediaObjectUrl=null;}picture.dataset.mediaKey=mediaKey;if(activeRoundMedia?.data){projectorObstacleMediaObjectUrl=URL.createObjectURL(new Blob([activeRoundMedia.data],{type:activeRoundMedia.type}));const media=document.createElement(activeRoundMedia.type.startsWith('video/')?'video':'img');media.src=projectorObstacleMediaObjectUrl;media.alt=activeRoundMedia.name||'Ảnh Vượt chướng ngại vật';if(media instanceof HTMLVideoElement){media.muted=true;media.loop=true;media.autoplay=true;media.playsInline=true;media.play().catch(()=>{});}picture.append(media);}else{const placeholder=document.createElement('span');placeholder.className='projector-obstacle-picture-empty';placeholder.textContent='Chưa có ảnh Vượt chướng ngại vật';picture.append(placeholder);}const tiles=[['1','obstacle-mask-top-left','top-left','M0 0H500V140.625H220V281.25H0Z'],['2','obstacle-mask-top-right','top-right','M500 0H1000V281.25H780V140.625H500Z'],['3','obstacle-mask-bottom-right','bottom-right','M780 281.25H1000V562.5H500V421.875H780Z'],['4','obstacle-mask-bottom-left','bottom-left','M0 281.25H220V421.875H500V562.5H0Z'],['5','obstacle-mask-center','center','M220 140.625H780V421.875H220Z']];for(const [label,shape,position,pathData] of tiles){if(state?.obstaclePictureRevealed?.includes(label))continue;const mask=document.createElement('div');mask.className=`projector-obstacle-mask obstacle-mask ${shape}`;const outline=document.createElementNS('http://www.w3.org/2000/svg','svg');outline.classList.add('projector-obstacle-outline');outline.setAttribute('viewBox','0 0 1000 562.5');outline.setAttribute('preserveAspectRatio','none');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',pathData);path.setAttribute('fill','none');path.setAttribute('stroke','#ffd700');path.setAttribute('stroke-width','12');path.setAttribute('stroke-linejoin','round');path.setAttribute('vector-effect','non-scaling-stroke');outline.append(path);const text=document.createElement('span');text.className=`obstacle-mask-label ${position}`;text.textContent=label;mask.append(outline,text);picture.append(mask);}}}
function fitProjectorObstacleQuestion(){const question=$('projectorObstacleQuestion');if(!question||!question.clientWidth||!question.clientHeight)return;question.style.removeProperty('font-size');const styles=getComputedStyle(question),baseSize=parseFloat(styles.fontSize),measure=document.createElement('div');measure.textContent=question.textContent;Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',width:`${question.clientWidth}px`,height:'auto',minHeight:'0',overflow:'visible',display:'block',padding:'0',border:'0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:styles.lineHeight,fontFamily:styles.fontFamily,fontWeight:styles.fontWeight});document.body.append(measure);let low=1,high=baseSize;for(let i=0;i<20;i++){const size=(low+high)/2;measure.style.fontSize=`${size}px`;if(measure.scrollHeight<=question.clientHeight)low=size;else high=size;}question.style.fontSize=`${Math.max(1,low)}px`;measure.remove();}
function renderProjector(state,previous){renderProjectorFinishQuestionPoints(state,previous);const playerRound=state.roundMode==='obstacle'||state.roundMode==='speed';$('projectorView').classList.toggle('projector-round-player-mode',playerRound);$('projectorQuestion').textContent=state.question||'';fitProjectorQuestion();const board=$('projectorScoreboard');board.innerHTML='';const projectorPlayerBoard=$('projectorPlayerScoreboard');projectorPlayerBoard.innerHTML='';const fastestId=state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId;const players=[...state.players].sort((a,b)=>b.score-a.score);if(!players.length){const empty=document.createElement('p');empty.className='projector-empty';empty.textContent='Đang chờ thí sinh';board.append(empty);const playerEmpty=document.createElement('p');playerEmpty.className='muted';playerEmpty.textContent='Đang chờ thí sinh';projectorPlayerBoard.append(playerEmpty);}else{players.forEach(p=>{const row=document.createElement('div');row.className='projector-player';if(p.id===fastestId)row.classList.add('fastest-buzzer');const identity=document.createElement('div');identity.className='projector-player-identity';const name=document.createElement('strong');name.textContent=p.name;identity.append(name);const score=document.createElement('strong');score.className='projector-player-score';score.textContent=p.score;row.append(identity,score);board.append(row);projectorPlayerBoard.append(scoreRow(p,false,p.id===fastestId));});}scaleProjectorScoreboard();renderPlayerQuestion(state);applySpotlightClass(projectorPlayerBoard,players);}
function fastestBuzzerId(buzzes=[]){return buzzes[0]?.playerId||null;}
function fitProjectorQuestion(){const question=$('projectorQuestion');if(!question||!question.clientWidth||!question.clientHeight)return;question.style.removeProperty('font-size');const baseSize=parseFloat(getComputedStyle(question).fontSize),measure=document.createElement('div');measure.textContent=question.textContent;Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',width:`${question.clientWidth}px`,height:'auto',minHeight:'0',maxHeight:'none',overflow:'visible',display:'block',flex:'none',padding:'0',border:'0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:'1.2',fontFamily:getComputedStyle(question).fontFamily});document.body.append(measure);let low=.5,high=baseSize;for(let i=0;i<18;i++){const size=(low+high)/2;measure.style.fontSize=`${size}px`;if(measure.scrollHeight<=question.clientHeight)low=size;else high=size;}question.style.fontSize=`${low>=baseSize-.1?baseSize:low}px`;measure.remove();}
function fitPlayerQuestion(){const display=$('questionDisplay'),text=$('questionDisplayText');if(!display||!text||!text.textContent||!display.clientWidth||!display.clientHeight)return;text.style.removeProperty('font-size');const styles=getComputedStyle(display),textStyles=getComputedStyle(text),width=display.clientWidth-parseFloat(styles.paddingLeft)-parseFloat(styles.paddingRight),height=display.clientHeight-parseFloat(styles.paddingTop)-parseFloat(styles.paddingBottom),baseSize=parseFloat(textStyles.fontSize),measure=document.createElement('div');measure.textContent=text.textContent;Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',width:`${width}px`,height:'auto',minHeight:'0',maxHeight:'none',overflow:'visible',display:'block',padding:'0',border:'0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:textStyles.lineHeight,fontFamily:textStyles.fontFamily,fontWeight:textStyles.fontWeight,letterSpacing:textStyles.letterSpacing});document.body.append(measure);let low=1,high=baseSize;for(let i=0;i<20;i++){const size=(low+high)/2;measure.style.fontSize=`${size}px`;if(measure.scrollHeight<=height)low=size;else high=size;}text.style.fontSize=`${Math.min(baseSize,Math.max(1,low))}px`;measure.remove();}
function scaleProjectorScoreboard(){if(!$('projectorView')||$('projectorView').classList.contains('hidden'))return;const panel=document.querySelector('.projector-score-panel'),board=$('projectorScoreboard');if(!panel||!board)return;const players=board.querySelectorAll('.projector-player');if(!players.length){board.style.setProperty('--projector-rows','1');board.style.setProperty('--projector-scale','1');return;}const rowHeight=board.clientHeight/players.length,scale=Math.max(.15,Math.min(1,rowHeight/148.5,board.clientWidth/607.5));board.style.setProperty('--projector-rows',String(players.length));board.style.setProperty('--projector-scale',String(scale));}
const projectorObserver=new ResizeObserver(()=>{scaleProjectorScoreboard();fitProjectorQuestion();});projectorObserver.observe(document.querySelector('.projector-score-panel'));projectorObserver.observe(document.querySelector('.projector-question-panel'));window.addEventListener('resize',()=>{scaleProjectorScoreboard();fitProjectorQuestion();});
const playerQuestionObserver=new ResizeObserver(()=>fitPlayerQuestion());playerQuestionObserver.observe($('questionDisplay'));window.addEventListener('resize',()=>requestAnimationFrame(fitPlayerQuestion));
function scoreRow(p,actions,highlight=false,judgeSteal=false){const row=document.createElement('div');row.className='playerrow';if(highlight||(latest?.roundMode==='obstacle'&&p.obstacleBuzzed))row.classList.add('fastest-buzzer');if(actions&&p.focused===false){row.classList.add('unfocused-player');row.title='Thí sinh đang rời khỏi trang này hoặc không focus vào trang.';}const name=document.createElement('div');name.innerHTML=`<div class="playername"><i class="${p.connected?'connected':'connected disconnected'}"></i></div><div class="playerteam"></div>`;name.querySelector('.playername').append(document.createTextNode(p.name));name.querySelector('.playerteam').textContent=p.team;const pts=document.createElement('div');pts.className='points';pts.textContent=p.score;row.append(name,pts);if(actions){const a=document.createElement('div');a.className='scoreactions';if(judgeSteal){for(const [label,correct] of [['ĐÚNG',true],['SAI',false]]){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{const result=await emitAck('host:finish:judge',{correct});if(!result.ok)toast(result.error);};a.append(b);}}const customInput=document.createElement('input');customInput.type='number';customInput.min='-100';customInput.max='1000';customInput.step='1';customInput.placeholder='Điểm';customInput.setAttribute('aria-label',`Số điểm thay đổi cho ${p.name}`);const customButton=document.createElement('button');customButton.textContent='ÁP DỤNG';customButton.title='Áp dụng số điểm đã nhập';customButton.onclick=()=>{const delta=Number(customInput.value);if(!Number.isInteger(delta)||delta< -100||delta>1000)return toast('Nhập số nguyên từ -100 đến 1000.');changeScore(p.id,delta);};a.append(customInput,customButton);const rm=document.createElement('button');rm.textContent='×';rm.title='Xóa người chơi';rm.onclick=()=>emitAck('host:remove',{playerId:p.id});a.append(rm);row.append(a);}return row;}
async function changeScore(playerId,delta){const r=await emitAck('host:score',{playerId,delta});if(!r.ok){toast(r.error);return false;}return true;}
async function judgeObstacleBuzzer(playerId,correct){let expectedPoints;if(correct){const preview=await emitAck('host:obstacle:bonus',{playerId});if(!preview.ok)return toast(preview.error);expectedPoints=preview.points;if(!window.confirm(`Bạn có muốn cộng thêm cho thí sinh này ${expectedPoints} điểm do trả lời đúng CNV không?`))return;}const result=await emitAck('host:obstacle:judge',{playerId,correct,expectedPoints});if(!result.ok){toast(result.error);return;}if(correct){for(let tile=1;tile<=5;tile++)hostObstacleRevealed.add(String(tile));hostObstacleVerdicts=Object.fromEntries([1,2,3,4,5].map(row=>[row,'Đ']));renderHostObstacleBoard();}toast(correct?`Đã cộng ${result.points} điểm CNV.`:'Đã ghi nhận thí sinh trả lời sai.');}
function renderHostPlayers(players,fastestId,state){$('hostPlayers').innerHTML='';if(!players.length){$('hostPlayers').innerHTML='<p class="muted">Chưa có người chơi. Chia sẻ mã phòng để mọi người tham gia.</p>';return;}players.forEach(p=>{const row=scoreRow(p,true,p.id===fastestId,Boolean(state?.roundMode==='finish'&&state.finishStealPending&&fastestId===p.id));if(state?.roundMode==='obstacle'&&p.obstacleBuzzed&&!p.obstacleBuzzJudged){const actions=row.querySelector('.scoreactions');for(const [label,correct] of [['Đúng',true],['Sai',false]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>judgeObstacleBuzzer(p.id,correct);actions?.append(button);}}$('hostPlayers').append(row);});}
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
function readObstacleAnswerCells(rowElement){return [...rowElement.querySelectorAll('.obstacle-answer-grid input')].map(input=>input.value);}
function readObstacleAnswer(rowElement){return readObstacleAnswerCells(rowElement).join('');}
function obstacleCharacterCount(value){return splitGraphemes(value).filter(character=>!/\s/u.test(character)).length;}
function updateObstacleLetterCount(rowElement){rowElement.querySelector('.obstacle-letter-count').textContent=String(obstacleCharacterCount(readObstacleAnswer(rowElement)));}
function renderObstacleCourse(){
 obstacleCourse.rows.forEach((row,index)=>{
  const element=$('databaseObstacleCourse').querySelector(`[data-obstacle-row="${index}"]`);
  const cells=Array.isArray(row.answerCells)?row.answerCells:splitGraphemes(row.answer||'');
  element.querySelectorAll('.obstacle-answer-grid input').forEach((input,cellIndex)=>{input.value=cells[cellIndex]||'';});
  element.querySelector('.obstacle-question').value=row.question||'';
  updateObstacleLetterCount(element);
 });
 $('databaseObstacleCourse').querySelector('.obstacle-keyword').value=obstacleCourse.keyword||'';
 $('databaseObstacleCourse').querySelector('.obstacle-keyword-question').value=obstacleCourse.keywordQuestion||'';
 updateObstacleKeywordCount();
 $('databaseObstacleCourse').querySelector('.obstacle-full-answer').value=obstacleCourse.fullAnswer||'';
 updateObstacleFullAnswerCount();
 renderHostObstacleBoard();
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
 renderHostObstacleBoard();
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
function updateIndependentTimer(){const t=latest&&latest.independentTimer;if(!t)return;const remaining=t.running&&t.deadline?Math.max(0,t.deadline-displayNow()):t.remainingMs;if($('hostIndependentDisplay'))$('hostIndependentDisplay').textContent=formatClock(remaining);if($('playerIndependentDisplay'))$('playerIndependentDisplay').textContent=formatClock(remaining);if($('projectorIndependentDisplay'))$('projectorIndependentDisplay').textContent=formatClock(remaining);if($('independentReset'))$('independentReset').disabled=Boolean(t.running&&remaining>0);if(role==='player'&&remaining<=0){$('answerInput').disabled=true;$('submitAnswer').disabled=true;}}
function updateTimer(){
 clearInterval(tickHandle);
 const paint=()=>{
  if(!latest){$('hostTimer').textContent='--';$('playerTimer').textContent='--';$('projectorQuestionTimerBox').classList.add('hidden');$('projectorQuestionTimer').textContent='';return;}
  const now=displayNow();
  const countdownDeadline=latest.buzzerCountdownDeadline;
  const countdownActive=Boolean(countdownDeadline&&countdownDeadline>now);
  const buzzerActive=Boolean(latest.deadline&&['playing','won','locked'].includes(latest.status));
  const buzzerDeadline=countdownDeadline|| (buzzerActive?latest.deadline:null);
  const buzzerSeconds=buzzerDeadline?(countdownDeadline?Math.max(1,Math.ceil((buzzerDeadline-now)/1000)):Math.max(0,Math.ceil((buzzerDeadline-now)/1000))):null;
  const openingSeconds=latest.openingDeadline?Math.max(0,Math.ceil((latest.openingDeadline-now)/1000)):null;
  const showOpeningTimer=!countdownDeadline&&openingSeconds!==null;
  if(role==='projector'){
   const independentTimer=latest.independentTimer;
   const obstacleSeconds=independentTimer?.deadline&&independentTimer.running?Math.max(0,Math.ceil((independentTimer.deadline-now)/1000)):Math.max(0,Math.ceil((independentTimer?.remainingMs||0)/1000));
   const showObstacleTimer=latest.roundMode==='obstacle'&&independentTimer?.duration===15&&Boolean(independentTimer.startedAt)&&obstacleSeconds>0;
   const showSpeedTimer=latest.roundMode==='speed'&&[20,30,40].includes(independentTimer?.duration)&&Boolean(independentTimer.startedAt)&&obstacleSeconds>0;
   const showProjectorTimer=showOpeningTimer&&openingSeconds>0;
   $('projectorQuestionTimerBox').classList.toggle('hidden',!showProjectorTimer);
   $('projectorQuestionTimer').textContent=showProjectorTimer?String(openingSeconds):'';
   $('projectorObstacleQuestionTimerBox').classList.toggle('hidden',!showObstacleTimer);
   $('projectorObstacleQuestionTimer').textContent=showObstacleTimer?String(obstacleSeconds):'';
   $('projectorSpeedQuestionTimerBox').classList.toggle('hidden',!showSpeedTimer);
   $('projectorSpeedQuestionTimer').textContent=showSpeedTimer?String(obstacleSeconds):'';
  }
  if(role==='player'){
   const canBuzz=canPlayerBuzz();
   $('buzzButton').disabled=!canBuzz;
   $('buzzButton').classList.toggle('ready',canBuzz);
   const firstBuzzerId=fastestBuzzerId(latest.buzzes);
   const wonByPlayer=latest.buzzerAlwaysOpen?firstBuzzerId===myId:latest.winnerId===myId;
   const winnerSeconds=latest.winnerCountdownDeadline&&wonByPlayer?Math.max(0,Math.ceil((latest.winnerCountdownDeadline-now)/1000)):null;
   const buzzLabel=$('buzzButton').querySelector('span');
   const me=latest.players.find(player=>player.id===myId);
   if(buzzLabel)buzzLabel.textContent=latest.roundMode==='obstacle'&&me?.obstacleBuzzed?'ĐÃ BẤM':countdownDeadline?String(buzzerSeconds):winnerSeconds!==null?String(winnerSeconds):'BẤM CHUÔNG';
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
 if(latest&&(latest.buzzerCountdownDeadline||latest.winnerCountdownDeadline||latest.openingDeadline||latest.independentTimer?.running||(latest.deadline&&['playing','won','locked'].includes(latest.status))))tickHandle=setInterval(paint,100);
}
socket.on('room:update',render);socket.on('connect',async()=>{syncServerClock();const params=new URLSearchParams(location.search),projectorCode=params.get('projector'),playerCode=params.get('room');if(projectorCode){role='projector';show('projectorView');const r=await emitAck('projector:join',{code:projectorCode});if(!r.ok){$('projectorQuestion').textContent=r.error;return;}roomCode=r.state.code;render(r.state);return;}if(playerCode){$('joinCode').value=playerCode.toUpperCase();show('playerSetup');}});setInterval(syncServerClock,30000);socket.on('disconnect',()=>toast('Mất kết nối máy chủ. Đang thử kết nối lại…'));
