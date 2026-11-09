const socket = io();
const $ = id => document.getElementById(id);
const views = ['home','hostSetup','playerSetup','hostView','hostDatabase','playerView','projectorView'];
let role = null, roomCode = null, myId = null, myTeam = null, latest = null, hostLink = null, lastStatus = null, audioCtx = null, tickHandle = null, independentTickHandle = setInterval(updateIndependentTimer, 100), projectorAudioQueue = [], projectorAudioBuffers = new Map(), projectorAudioReady = false, projectorAudioLoading = new Map(), projectorAudioResumePending = false, projectorOpeningMusicSource = null, projectorOpeningMusicKey = null, projectorOpeningMusicGeneration = 0, databaseQuestions = [], openingCorrectStreak = 0, openingStreakPlayerId = '', openingScorePending = false;
function show(id){ views.forEach(v => $(v).classList.toggle('hidden',v!==id)); document.body.classList.toggle('player-active',id==='playerView'); document.body.classList.toggle('host-active',id==='hostView'||id==='hostDatabase'); document.body.classList.toggle('projector-active',id==='projectorView'); }
function toast(msg){ $('toast').textContent=msg; $('toast').classList.remove('hidden'); setTimeout(()=>$('toast').classList.add('hidden'),2600); }
function canPlayerBuzz(){if(role!=='player'||!latest||latest.status!=='playing'||latest.buzzerCountdownDeadline||!latest.deadline||Date.now()>=latest.deadline)return false;const me=latest.players.find(player=>player.id===myId);return latest.buzzerAlwaysOpen?!Boolean(me&&me.buzzedAt):!latest.winnerId;}
function sound(type){ try { audioCtx ||= new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.connect(g);g.connect(audioCtx.destination);o.type='sine';o.frequency.value=type==='buzz'?880:type==='win'?660:440;g.gain.setValueAtTime(.001,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.18,audioCtx.currentTime+.015);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+(type==='win'?.45:.18));o.start();o.stop(audioCtx.currentTime+(type==='win'?.48:.2)); }catch(e){} }
async function loadProjectorAudio(type){if(projectorAudioBuffers.has(type))return projectorAudioBuffers.get(type);if(projectorAudioLoading.has(type))return projectorAudioLoading.get(type);const loading=(async()=>{const context=audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());const files={buzz:'Buzz.mp3',correct:'Correct.mp3',wrong:'Wrong.mp3',start:'StartKD.mp3',end:'EndKD.mp3',opening:'KD60s.mp3',musicA:'KDmusicA.mp3',musicB:'KDmusicB.mp3',musicC:'KDmusicC.mp3',blank:'Blank.ogg'};const file=files[type];if(!file)throw new Error('Không tìm thấy tệp âm thanh.');const response=await fetch(`/Olympia%20Music/${encodeURIComponent(file)}`);if(!response.ok)throw new Error(`Không tải được ${file} (${response.status}).`);const buffer=await context.decodeAudioData(await response.arrayBuffer());projectorAudioBuffers.set(type,buffer);return buffer;})();projectorAudioLoading.set(type,loading);try{return await loading;}finally{projectorAudioLoading.delete(type);}}
function playNextProjectorAudio(){if(role!=='projector'||!projectorAudioReady||!projectorAudioQueue.length)return;const type=projectorAudioQueue[0],buffer=projectorAudioBuffers.get(type);if(!buffer)return;const context=audioCtx;if(context.state!=='running'){if(!projectorAudioResumePending){projectorAudioResumePending=true;context.resume().then(()=>{projectorAudioResumePending=false;playNextProjectorAudio();}).catch(error=>{projectorAudioResumePending=false;toast(`Không thể tiếp tục phát âm thanh: ${error.message}`);});}return;}projectorAudioQueue.shift();const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.onended=playNextProjectorAudio;source.start();}
async function queueProjectorAudio(type){if(!['buzz','correct','wrong','start','end','opening','blank'].includes(type))return;projectorAudioQueue.push(type);if(!projectorAudioBuffers.has(type)){try{await loadProjectorAudio(type);}catch(error){projectorAudioQueue=projectorAudioQueue.filter(item=>item!==type);toast(`Không thể tải âm thanh máy chiếu: ${error.message}`);return;}}playNextProjectorAudio();}
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
 source.connect(audioCtx.destination);
 source.onended=()=>{if(projectorOpeningMusicSource===source)projectorOpeningMusicSource=null;};
 projectorOpeningMusicSource=source;
 source.start();
}
async function unlockProjectorAudio(){if(role!=='projector')return;try{const context=audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());await context.resume();await Promise.all(['buzz','correct','wrong','start','end','opening'].map(loadProjectorAudio));projectorAudioReady=true;playNextProjectorAudio();syncProjectorOpeningMusic(latest,true);toast('Âm thanh máy chiếu đã bật.');}catch(error){projectorAudioReady=false;toast(`Không thể bật âm thanh máy chiếu: ${error.message}`);}}
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
$('openProjector').onclick=()=>{const projector=window.open(`${location.origin}/?projector=${encodeURIComponent(roomCode)}`,'_blank');if(!projector)toast('Trình duyệt đã chặn cửa sổ máy chiếu. Hãy cho phép cửa sổ bật lên rồi thử lại.');};
$('openDatabase').onclick=async()=>{show('hostDatabase');await loadDatabase();};
$('closeDatabase').onclick=()=>show('hostView');
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
$('importWorkbook').onclick=async()=>{const file=$('databaseFile').files[0];if(!file)return toast('Hãy chọn file Excel .xlsx trước.');try{const questions=await window.parseOlympiaWorkbook(file);if(!confirm(`Tìm thấy ${questions.length} câu hỏi và đáp án tương ứng trong sheet “Khởi Động” (câu hỏi cột C, đáp án cột D). Nhập thêm vào database của phòng này?`))return;const r=await emitAck('host:database:import',{questions});if(!r.ok)return toast(r.error);databaseQuestions=r.questions;renderDatabase();refreshSpotlightControls(latest);syncHostOpeningAnswer(latest);$('databaseFile').value='';toast(`Đã nhập ${r.imported} câu hỏi.`);}catch(error){toast(`Không thể nhập file Excel: ${error.message}`);}};
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
$('hostQuestionInput').addEventListener('keydown',async e=>{if(e.key!=='Enter'||e.shiftKey||e.isComposing)return;e.preventDefault();const r=await emitAck('host:question',{question:$('hostQuestionInput').value,resetBuzzer:true});if(!r.ok)toast(r.error);});
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
$('independentPause').onclick=async()=>{const r=await emitAck('host:independent:pause');if(!r.ok)toast(r.error);};
$('independentReset').onclick=async()=>{const r=await emitAck('host:independent:reset');if(!r.ok)toast(r.error);};
$('revealLatestAnswers').onclick=async()=>{const r=await emitAck('host:answer:reveal');if(!r.ok)return toast(r.error);toast(r.count?`Đã hiện đáp án mới nhất cho ${r.count} thí sinh.`:'Chưa có thí sinh gửi câu trả lời.');};
$('closeAnswerReveal').onclick=()=>$('answerRevealDialog').close();
socket.on('player:answer:reveal',({answers}={})=>{if(role!=='player'||!Array.isArray(answers))return;const list=$('revealedAnswers');list.replaceChildren();if(!answers.length){const empty=document.createElement('p');empty.className='revealed-answers-empty';empty.textContent='Chưa có thí sinh gửi câu trả lời.';list.append(empty);}else{answers.forEach(item=>{if(!item||typeof item.name!=='string'||typeof item.team!=='string'||typeof item.answer!=='string'||!Number.isFinite(item.elapsedMs))return;const entry=document.createElement('article');entry.className='revealed-answer';const heading=document.createElement('div');heading.className='revealed-answer-heading';const player=document.createElement('strong');player.textContent=`${item.name} · ${item.team}`;const time=document.createElement('time');time.textContent=formatElapsed(item.elapsedMs);heading.append(player,time);const answer=document.createElement('p');answer.textContent=item.answer;entry.append(heading,answer);list.append(entry);});} $('answerRevealDialog').showModal();});
$('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(hostLink);toast('Đã sao chép link tham gia.');}catch(e){toast(hostLink);}};
let buzzPointerId=null,buzzPointerEligible=false;
document.addEventListener('pointerdown',event=>{if(role!=='player')return;const rect=$('buzzButton').getBoundingClientRect();const inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;if(!inside)return;buzzPointerId=event.pointerId;buzzPointerEligible=canPlayerBuzz();},true);
document.addEventListener('pointerup',event=>{if(event.pointerId!==buzzPointerId)return;const rect=$('buzzButton').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){buzzPointerEligible=false;buzzPointerId=null;}},true);
document.addEventListener('pointercancel',event=>{if(event.pointerId===buzzPointerId){buzzPointerEligible=false;buzzPointerId=null;}},true);
$('buzzButton').onclick=async event=>{if(event.detail>0){const startedWhileOpen=buzzPointerEligible;buzzPointerEligible=false;buzzPointerId=null;if(!startedWhileOpen)return;}if(!canPlayerBuzz())return;const r=await emitAck('player:buzz');if(!r.ok)toast(r.error);};
$('answerForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('answerInput');const answer=input.value.trim();if(!answer)return toast('Bạn chưa nhập câu trả lời.');$('submitAnswer').disabled=true;const r=await emitAck('player:answer',{answer});$('submitAnswer').disabled=Boolean(input.disabled);if(!r.ok)return toast(r.error);if(input.value.trim()===answer)input.value='';$('lastAnswerText').textContent=answer;$('lastAnswerTime').textContent=`Đã gửi lúc ${formatElapsed(r.elapsedMs)}`;$('answerMessage').textContent=`Đã ghi nhận câu trả lời lúc ${formatElapsed(r.elapsedMs)}. Bạn có thể gửi tiếp.`;$('answerMessage').className='answer-confirm';if(!input.disabled)input.focus();});
$('answerInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('answerForm').requestSubmit();}});
function formatElapsed(ms){const m=Math.floor(ms/60000),s=Math.floor(ms%60000/1000),x=ms%1000;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`;}
socket.on('answers:update',answers=>renderAnswers(answers));
function renderAnswers(answers=[]){const latestByPlayer=new Map();for(const a of answers){const old=latestByPlayer.get(a.playerId);if(!old||a.submittedAt>=old.submittedAt)latestByPlayer.set(a.playerId,a);}const latestAnswers=[...latestByPlayer.values()].sort((a,b)=>a.elapsedMs-b.elapsedMs);$('answerCount').textContent=`${latestAnswers.length} thí sinh đã trả lời`;$('hostAnswers').innerHTML='';if(!latestAnswers.length){$('hostAnswers').innerHTML='<p class="muted">Chưa có câu trả lời.</p>';return;}latestAnswers.forEach(a=>{const card=document.createElement('article');card.className='answercard';const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${a.name} · ${a.team}`;const time=document.createElement('time');time.textContent=formatElapsed(a.elapsedMs);top.append(who,time);const body=document.createElement('p');body.textContent=a.answer;card.append(top,body);$('hostAnswers').append(card);});}
function renderBuzzes(buzzes=[]){if(!$('hostBuzzes'))return;$('buzzCount').textContent=`${buzzes.length} lượt`;$('hostBuzzes').innerHTML='';if(!buzzes.length){$('hostBuzzes').innerHTML='<p class="muted">Chưa có thí sinh bấm chuông.</p>';return;}[...buzzes].sort((a,b)=>a.elapsedMs-b.elapsedMs).forEach((b,i)=>{const card=document.createElement('article');card.className='answercard';const top=document.createElement('div');top.className='answercardtop';const who=document.createElement('strong');who.textContent=`${i+1}. ${b.name} · ${b.team}`;const time=document.createElement('time');time.textContent=formatElapsed(b.elapsedMs);top.append(who,time);card.append(top);$('hostBuzzes').append(card);});}
function queueNewProjectorBuzzes(state,previous){if(role!=='projector'||!previous)return;if(state.buzzerAlwaysOpen&&!(previous.buzzes||[]).length&&(state.buzzes||[]).length)queueProjectorBuzz();else if(!state.buzzerAlwaysOpen&&!previous.buzzerAlwaysOpen&&state.winnerId&&state.winnerId!==previous.winnerId)queueProjectorBuzz();}
socket.on('projector:audio',({type}={})=>{if(role==='projector'&&['correct','wrong','start','end','opening','blank'].includes(type))queueProjectorAudio(type);});
function renderBase(state){const previous=latest;if(!state)return;queueNewProjectorBuzzes(state,previous);latest=state;if(role==='projector')syncProjectorOpeningMusic(state);if(role==='player')$('questionDisplay').textContent=state.question||'CÂU HỎI';if(role==='host'&&!$('hostQuestionInput').matches(':focus'))$('hostQuestionInput').value=state.question||'';if(role==='projector'){renderProjector(state);return;}const names={waiting:'ĐANG CHỜ',playing:'CHUÔNG ĐANG MỞ',won:'ĐÃ CÓ NGƯỜI BẤM',locked:'ĐÃ KHÓA',timeout:'HẾT THỜI GIAN'};const winner=state.players.find(p=>p.id===state.winnerId);
if(role==='host'){$('hostStatus').textContent=names[state.status]||state.status;$('hostStatus').className='status '+(state.status==='playing'?'live':state.status==='won'?'won':'');$('hostWinner').classList.add('hidden');$('hostWinner').textContent='';$('alwaysOpen').checked=Boolean(state.buzzerAlwaysOpen);$('playerCount').textContent=`${state.players.length} người`;renderHostPlayers(state.players,state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId);renderBuzzes(state.buzzes||[]);$('startRoundDelayed').disabled=Boolean(state.buzzerCountdownDeadline);}
if(role==='player'){const wasAnswering=Boolean(previous&&previous.independentTimer&&previous.independentTimer.running&&previous.independentTimer.remainingMs>0);const isAnswering=Boolean(state.independentTimer&&state.independentTimer.running&&state.independentTimer.remainingMs>0);if(isAnswering&&!wasAnswering){$('answerInput').value='';$('answerInput').disabled=false;setTimeout(()=>$('answerInput').focus(),0);} $('playerStatus').textContent=names[state.status]||state.status;$('playerStatus').className='status '+(state.status==='playing'?'live':state.status==='won'?'won':'');const me=state.players.find(p=>p.id===myId);$('myScore').textContent=me?me.score:0;if(me&&me.latestAnswer){$('lastAnswerText').textContent=me.latestAnswer.answer;$('lastAnswerTime').textContent=`Đã gửi lúc ${formatElapsed(me.latestAnswer.elapsedMs)}`;}const canBuzz=state.status==='playing'&&!state.buzzerCountdownDeadline&&(state.buzzerAlwaysOpen?!Boolean(me&&me.buzzedAt):!state.winnerId);$('buzzButton').disabled=!canBuzz;$('buzzButton').classList.toggle('ready',canBuzz);$('buzzButton').classList.toggle('pressed',state.buzzerAlwaysOpen?Boolean(me&&me.buzzedAt):state.winnerId===myId);const canSubmitAnswer=isAnswering;$('answerInput').disabled=!canSubmitAnswer;$('submitAnswer').disabled=!canSubmitAnswer;$('answerMessage').textContent=canSubmitAnswer?'Bạn có thể gửi nhiều câu trả lời cho đến khi hết giờ. Nhấn Enter để gửi nhanh (Shift + Enter để xuống dòng).':'Chờ Host bắt đầu hoặc tiếp tục thời gian trả lời...';$('answerMessage').className='muted';$('playerMessage').textContent=state.buzzerCountdownDeadline?'Chuông sẽ mở sau khi đếm ngược kết thúc.':state.buzzerAlwaysOpen&&state.status==='playing'?(me&&me.buzzedAt?'Bạn đã bấm chuông. Hãy chờ Host!':'Chuông luôn mở – mỗi thí sinh được bấm một lần!'):winner?(winner.id===myId?'Bạn đã bấm chuông đầu tiên!':`${winner.name} đã bấm chuông trước.`):state.status==='playing'?'Chuông đã mở – hãy bấm thật nhanh!':state.status==='timeout'?'Đã hết thời gian.':state.status==='locked'?'Chuông đã khóa. Ô trả lời hoạt động theo đồng hồ riêng.':'Chờ Host mở chuông…';$('playerScoreboard').innerHTML='';const fastestId=state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId;[...state.players].sort((a,b)=>b.score-a.score).forEach(p=>$('playerScoreboard').append(scoreRow(p,false,p.id===fastestId)));}
if((lastStatus==='playing'||lastStatus==='locked')&&state.status==='won')sound('win');if(state.status==='playing'&&lastStatus!=='playing')sound('open');lastStatus=state.status;updateTimer();updateIndependentTimer();}
function render(state){
 renderBase(state);
 if(!state)return;
 if(role==='host')setOpeningNavigationEnabled(Boolean(state.openingQuestionRound&&Number.isInteger(state.openingQuestionIndex)));
 if(role==='host'){refreshSpotlightControls(state);syncHostOpeningAnswer(state);applySpotlightClass($('hostPlayers'),state.players);}
 else if(role==='player')applySpotlightClass($('playerScoreboard'),[...state.players].sort((a,b)=>b.score-a.score));
 else if(role==='projector')applySpotlightClass($('projectorScoreboard'),[...state.players].sort((a,b)=>b.score-a.score));
}
function setOpeningNavigationEnabled(enabled){$('nextOpeningQuestion').disabled=!enabled;$('previousOpeningQuestion').disabled=!enabled;}
function applySpotlightClass(container,players){const highlightedId=latest?.buzzerAlwaysOpen?fastestBuzzerId(latest.buzzes):latest?.spotlightPlayerId;[...container.querySelectorAll('.playerrow,.projector-player')].forEach((row,index)=>row.classList.toggle('spotlight-player',players[index]?.id===highlightedId));}
function syncHostOpeningAnswer(state){
 if(role!=='host')return;
 if(!state.openingQuestionRound||!Number.isInteger(state.openingQuestionIndex)){ $('hostAnswerNote').value=''; return; }
 const questions=databaseQuestions.filter(question=>question.round===state.openingQuestionRound).sort((a,b)=>(a.sourceRow||0)-(b.sourceRow||0));
 $('hostAnswerNote').value=questions[state.openingQuestionIndex]?.answer||'';
}
function renderProjector(state){$('projectorQuestion').textContent=state.question||'CÂU HỎI';fitProjectorQuestion();const board=$('projectorScoreboard');board.innerHTML='';const fastestId=state.buzzerAlwaysOpen?fastestBuzzerId(state.buzzes):state.winnerId;const players=[...state.players].sort((a,b)=>b.score-a.score);if(!players.length){const empty=document.createElement('p');empty.className='projector-empty';empty.textContent='Đang chờ thí sinh';board.append(empty);}else{players.forEach(p=>{const row=document.createElement('div');row.className='projector-player';if(p.id===fastestId)row.classList.add('fastest-buzzer');const identity=document.createElement('div');identity.className='projector-player-identity';const name=document.createElement('strong');name.textContent=p.name;identity.append(name);const score=document.createElement('strong');score.className='projector-player-score';score.textContent=p.score;row.append(identity,score);board.append(row);});}scaleProjectorScoreboard();}
function fastestBuzzerId(buzzes=[]){return buzzes[0]?.playerId||null;}
function fitProjectorQuestion(){const question=$('projectorQuestion');if(!question||!question.clientWidth||!question.clientHeight)return;question.style.removeProperty('font-size');const baseSize=parseFloat(getComputedStyle(question).fontSize),measure=document.createElement('div');measure.textContent=question.textContent;Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',width:`${question.clientWidth}px`,height:'auto',minHeight:'0',maxHeight:'none',overflow:'visible',display:'block',flex:'none',padding:'0',border:'0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:'1.2',fontFamily:getComputedStyle(question).fontFamily});document.body.append(measure);let low=.5,high=baseSize;for(let i=0;i<18;i++){const size=(low+high)/2;measure.style.fontSize=`${size}px`;if(measure.scrollHeight<=question.clientHeight)low=size;else high=size;}question.style.fontSize=`${low>=baseSize-.1?baseSize:low}px`;measure.remove();}
function scaleProjectorScoreboard(){if(!$('projectorView')||$('projectorView').classList.contains('hidden'))return;const panel=document.querySelector('.projector-score-panel'),board=$('projectorScoreboard');if(!panel||!board)return;const players=board.querySelectorAll('.projector-player');if(!players.length){board.style.setProperty('--projector-rows','1');board.style.setProperty('--projector-scale','1');return;}const rowHeight=board.clientHeight/players.length,scale=Math.max(.15,Math.min(1,rowHeight/148.5,board.clientWidth/607.5));board.style.setProperty('--projector-rows',String(players.length));board.style.setProperty('--projector-scale',String(scale));}
const projectorObserver=new ResizeObserver(()=>{scaleProjectorScoreboard();fitProjectorQuestion();});projectorObserver.observe(document.querySelector('.projector-score-panel'));projectorObserver.observe(document.querySelector('.projector-question-panel'));window.addEventListener('resize',()=>{scaleProjectorScoreboard();fitProjectorQuestion();});
function scoreRow(p,actions,highlight=false){const row=document.createElement('div');row.className='playerrow';if(highlight)row.classList.add('fastest-buzzer');if(actions&&p.focused===false){row.classList.add('unfocused-player');row.title='Thí sinh đang rời khỏi trang này hoặc không focus vào trang.';}const name=document.createElement('div');name.innerHTML=`<div class="playername"><i class="${p.connected?'connected':'connected disconnected'}"></i></div><div class="playerteam"></div>`;name.querySelector('.playername').append(document.createTextNode(p.name));name.querySelector('.playerteam').textContent=p.team;const pts=document.createElement('div');pts.className='points';pts.textContent=p.score;row.append(name,pts);if(actions){const a=document.createElement('div');a.className='scoreactions';for(const [label,delta,cls] of [['+10',10,''],['-5',-5,'minus']]){const b=document.createElement('button');b.textContent=label;b.className=cls;b.onclick=()=>changeScore(p.id,delta);a.append(b);}const customInput=document.createElement('input');customInput.type='number';customInput.min='-100';customInput.max='1000';customInput.step='1';customInput.placeholder='Điểm';customInput.setAttribute('aria-label',`Số điểm thay đổi cho ${p.name}`);const customButton=document.createElement('button');customButton.textContent='ÁP DỤNG';customButton.title='Áp dụng số điểm đã nhập';customButton.onclick=()=>{const delta=Number(customInput.value);if(!Number.isInteger(delta)||delta< -100||delta>1000)return toast('Nhập số nguyên từ -100 đến 1000.');changeScore(p.id,delta);};a.append(customInput,customButton);const rm=document.createElement('button');rm.textContent='×';rm.title='Xóa người chơi';rm.onclick=()=>emitAck('host:remove',{playerId:p.id});a.append(rm);row.append(a);}return row;}
async function changeScore(playerId,delta){const r=await emitAck('host:score',{playerId,delta});if(!r.ok){toast(r.error);return false;}return true;}
function renderHostPlayers(players,fastestId){$('hostPlayers').innerHTML='';if(!players.length){$('hostPlayers').innerHTML='<p class="muted">Chưa có người chơi. Chia sẻ mã phòng để mọi người tham gia.</p>';return;}players.forEach(p=>$('hostPlayers').append(scoreRow(p,true,p.id===fastestId)));}
async function loadDatabase(){const r=await emitAck('host:database:get');if(!r.ok){toast(r.error);show('hostView');return;}databaseQuestions=r.questions;renderDatabase();refreshSpotlightControls(latest);syncHostOpeningAnswer(latest);}
function refreshSpotlightControls(state){
 if(role!=='host')return;
 const rounds=['Thí sinh 1','Thí sinh 2','Thí sinh 3','Thí sinh 4','Lượt chung'].filter(round=>databaseQuestions.some(question=>question.round===round));
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
 if(!databaseQuestions.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='Database đang trống. Chọn file Excel để nhập hoặc thêm câu hỏi mới.';container.append(empty);return;}
 const roundOrder=['Thí sinh 1','Thí sinh 2','Thí sinh 3','Thí sinh 4','Lượt chung'];
 const rounds=[...roundOrder.filter(round=>databaseQuestions.some(question=>(question.round||'Chưa phân loại')===round)),...new Set(databaseQuestions.map(question=>question.round||'Chưa phân loại').filter(round=>!roundOrder.includes(round)))];
 const table=document.createElement('table');
 table.className='database-table';
 const thead=document.createElement('thead');
 const headerRow=document.createElement('tr');
 for(const label of ['Lượt','Câu hỏi','Đáp án']){const th=document.createElement('th');th.scope='col';th.textContent=label;headerRow.append(th);}
 thead.append(headerRow);table.append(thead);
 for(const roundName of rounds){
  const groupQuestions=databaseQuestions.filter(question=>(question.round||'Chưa phân loại')===roundName).sort((a,b)=>(a.sourceRow||0)-(b.sourceRow||0));
  if(!groupQuestions.length)continue;
  const body=document.createElement('tbody');
  body.className='database-question-group';
  const editedQuestions=[];
  let roundInput;
  groupQuestions.forEach((question,index)=>{
   const row=document.createElement('tr');
   if(index===0){
    const roundCell=document.createElement('td');
    roundCell.className='database-round-cell';
    roundCell.rowSpan=groupQuestions.length;
    roundInput=document.createElement('input');
    roundInput.type='text';roundInput.maxLength=120;roundInput.value=roundName;roundInput.setAttribute('aria-label',`Tên lượt hiện tại: ${roundName}`);
    const saveRound=document.createElement('button');
    saveRound.type='button';saveRound.className='secondary';saveRound.textContent='LƯU LƯỢT';
    saveRound.onclick=async()=>{
     const newRound=roundInput.value.trim();
     if(!newRound)return toast('Tên lượt không được để trống.');
     saveRound.disabled=true;
     const result=await emitAck('host:database:updateGroup',{questions:editedQuestions.map(item=>({id:item.question.id,round:newRound,prompt:item.prompt.value,answer:item.answer.value}))});
     saveRound.disabled=false;
     if(!result.ok)return toast(result.error);
     databaseQuestions=result.questions;renderDatabase();syncHostOpeningAnswer(latest);toast('Đã lưu lượt và các câu hỏi, đáp án.');
    };
    roundCell.append(roundInput,saveRound);row.append(roundCell);
   }
   const questionCell=document.createElement('td');
   questionCell.className='database-prompt-cell';
   const prompt=document.createElement('textarea');
   prompt.rows=2;prompt.maxLength=5000;prompt.value=question.prompt;prompt.setAttribute('aria-label',`Câu hỏi: ${roundName}`);
   questionCell.append(prompt);
   const answerCell=document.createElement('td');
   answerCell.className='database-answer-cell';
   const answer=document.createElement('textarea');
   answer.rows=2;answer.maxLength=5000;answer.value=question.answer||'';answer.setAttribute('aria-label',`Đáp án: ${roundName}`);
   answerCell.append(answer);
   editedQuestions.push({question,prompt,answer});
   row.append(questionCell,answerCell);body.append(row);
  });
  table.append(body);
 }
 container.append(table);
}
function formatClock(ms){const total=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}
function updateIndependentTimer(){const t=latest&&latest.independentTimer;if(!t)return;const remaining=t.running&&t.deadline?Math.max(0,t.deadline-Date.now()):t.remainingMs;if($('hostIndependentDisplay'))$('hostIndependentDisplay').textContent=formatClock(remaining);if($('playerIndependentDisplay'))$('playerIndependentDisplay').textContent=formatClock(remaining);if($('independentReset'))$('independentReset').disabled=Boolean(t.running&&remaining>0);if(role==='player'&&remaining<=0){$('answerInput').disabled=true;$('submitAnswer').disabled=true;}}
function updateTimer(){
 clearInterval(tickHandle);
 const paint=()=>{
  if(!latest){$('hostTimer').textContent='--';$('playerTimer').textContent='--';return;}
  const now=Date.now();
  const countdownDeadline=latest.buzzerCountdownDeadline;
  const countdownActive=Boolean(countdownDeadline&&countdownDeadline>now);
  const buzzerActive=Boolean(latest.deadline&&['playing','won','locked'].includes(latest.status));
  const buzzerDeadline=countdownDeadline|| (buzzerActive?latest.deadline:null);
  const buzzerSeconds=buzzerDeadline?(countdownDeadline?Math.max(1,Math.ceil((buzzerDeadline-now)/1000)):Math.max(0,Math.ceil((buzzerDeadline-now)/1000))):null;
  const openingSeconds=latest.openingDeadline?Math.max(0,Math.ceil((latest.openingDeadline-now)/1000)):null;
  if(role==='player'){
   const canBuzz=canPlayerBuzz();
   $('buzzButton').disabled=!canBuzz;
   $('buzzButton').classList.toggle('ready',canBuzz);
   const firstBuzzerId=fastestBuzzerId(latest.buzzes);
   const wonByPlayer=latest.buzzerAlwaysOpen?firstBuzzerId===myId:latest.winnerId===myId;
   const winnerSeconds=latest.winnerCountdownDeadline&&wonByPlayer?Math.max(0,Math.ceil((latest.winnerCountdownDeadline-now)/1000)):null;
   const buzzLabel=$('buzzButton').querySelector('span');
   if(buzzLabel)buzzLabel.textContent=countdownDeadline?String(buzzerSeconds):winnerSeconds!==null?String(winnerSeconds):'BẤM CHUÔNG';
   const showOpeningTimer=!countdownDeadline&&openingSeconds!==null;
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
socket.on('room:update',render);socket.on('connect',async()=>{const params=new URLSearchParams(location.search),projectorCode=params.get('projector'),playerCode=params.get('room');if(projectorCode){role='projector';show('projectorView');const r=await emitAck('projector:join',{code:projectorCode});if(!r.ok){$('projectorQuestion').textContent=r.error;return;}roomCode=r.state.code;render(r.state);return;}if(playerCode){$('joinCode').value=playerCode.toUpperCase();show('playerSetup');}});socket.on('disconnect',()=>toast('Mất kết nối máy chủ. Đang thử kết nối lại…'));
