window.parseOlympiaWorkbook = async file => {
  const maxBytes = 20 * 1024 * 1024;
  if (!file || !file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Chỉ hỗ trợ file .xlsx.');
  if (file.size > maxBytes) throw new Error('Dung lượng file Excel tối đa là 20 MB.');
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const entries = new Map();
  let endOffset = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { endOffset = i; break; }
  }
  if (endOffset < 0) throw new Error('File không có cấu trúc workbook .xlsx hợp lệ.');
  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Không đọc được danh sách nội dung trong workbook.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    let bytes;
    if (method === 0) bytes = compressed;
    else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`Workbook dùng kiểu nén không hỗ trợ (${method}).`);
    }
    entries.set(name, decoder.decode(bytes));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  const parseXml = (name, optional = false) => {
    const text = entries.get(name);
    if (!text && optional) return null;
    if (!text) throw new Error(`Workbook thiếu thành phần ${name}.`);
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error(`Không đọc được XML trong ${name}.`);
    return document;
  };
  const workbook = parseXml('xl/workbook.xml');
  const relationships = parseXml('xl/_rels/workbook.xml.rels');
  const relationTargets = new Map([...relationships.getElementsByTagNameNS('*', 'Relationship')].map(item => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const normalizeTarget = target => {
    const parts = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/');
    const normalized = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') normalized.pop();
      else normalized.push(part);
    }
    return normalized.join('/');
  };
  const sharedDocument = parseXml('xl/sharedStrings.xml', true);
  const sharedStrings = sharedDocument
    ? [...sharedDocument.getElementsByTagNameNS('*', 'si')].map(item => [...item.getElementsByTagNameNS('*', 't')].map(node => node.textContent).join(''))
    : [];
  const normalizeSheetName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').trim();
  const sheetsByName = new Map([...workbook.getElementsByTagNameNS('*', 'sheet')].map(sheet => [normalizeSheetName(sheet.getAttribute('name')), sheet]));
  const readSheet = (name, optional = false) => {
    const sheet = sheetsByName.get(normalizeSheetName(name));
    if (!sheet) {
      if (optional) return null;
      throw new Error(`Không tìm thấy sheet “${name}” trong workbook.`);
    }
    const target = relationTargets.get(sheet.getAttribute('r:id'));
    if (!target) throw new Error(`Không tìm thấy dữ liệu của sheet “${name}”.`);
    const worksheet = parseXml(normalizeTarget(target));
    const valuesByCell = new Map();
    for (const cell of worksheet.getElementsByTagNameNS('*', 'c')) {
      const reference = cell.getAttribute('r').toUpperCase();
      const type = cell.getAttribute('t');
      let value = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent || '';
      if (type === 's') value = sharedStrings[Number(value)] || '';
      else if (type === 'inlineStr') value = [...cell.getElementsByTagNameNS('*', 't')].map(node => node.textContent).join('');
      valuesByCell.set(reference, value.trim());
    }
    return { sheet, valuesByCell };
  };
  const openingData = readSheet('Khởi Động', true);
  const speedData = readSheet('Tăng tốc B', true);
  const obstacleData = readSheet('VCNV', true);
  const finishData = readSheet('Về đích', true);
  const bonusData = readSheet('CHP', true);
  if (!openingData && !speedData && !obstacleData && !finishData && !bonusData) throw new Error('Không tìm thấy sheet “Khởi Động”, “Tăng tốc B”, “VCNV”, “Về đích” hoặc “CHP” trong workbook.');
  const questions = [];
  if (openingData) {
    const groups = [
      { round: 'Thí sinh 1', start: 4, end: 23 },
      { round: 'Thí sinh 2', start: 26, end: 45 },
      { round: 'Thí sinh 3', start: 48, end: 67 },
      { round: 'Thí sinh 4', start: 70, end: 89 },
      { round: 'Lượt chung', start: 92, end: 111 }
    ];
    for (const group of groups) {
      for (let row = group.start; row <= group.end; row++) {
        const sourceCell = `C${row}`;
        const answerCell = `D${row}`;
        const prompt = openingData.valuesByCell.get(sourceCell) || '';
        if (!prompt) continue;
        questions.push({
          round: group.round,
          prompt,
          answer: openingData.valuesByCell.get(answerCell) || '',
          notes: '',
          points: 0,
          sourceSheet: openingData.sheet.getAttribute('name') || 'Khởi Động',
          sourceRow: row,
          rawData: { 'Ô nguồn': sourceCell, 'Ô đáp án': answerCell }
        });
      }
    }
  }
  if (bonusData) {
    for (let row = 3; row <= 22; row++) {
      const prompt = bonusData.valuesByCell.get(`C${row}`) || '';
      if (!prompt) continue;
      questions.push({ round: 'Câu hỏi phụ', prompt, answer: bonusData.valuesByCell.get(`D${row}`) || '', notes: '', points: 0, sourceSheet: 'CHP', sourceRow: row - 2, rawData: { 'Ô nguồn': `C${row}`, 'Ô đáp án': `D${row}` } });
    }
  }
  const speedQuestions = speedData ? Array.from({ length: 4 }, (_, index) => {
    const row = index + 3;
    return {
      prompt: speedData.valuesByCell.get(`B${row}`) || '',
      answer: speedData.valuesByCell.get(`C${row}`) || ''
    };
  }) : null;
  const obstacleCourse = obstacleData ? {
    rows: Array.from({ length: 4 }, (_, index) => {
      const row = index + 3;
      const answerCells = Array.from({ length: 15 }, (_, column) => obstacleData.valuesByCell.get(`${String.fromCharCode(66 + column)}${row}`) || '');
      return { answer: answerCells.join(''), answerCells, question: obstacleData.valuesByCell.get(`V${row}`) || '' };
    }),
    keyword: obstacleData.valuesByCell.get('B7') || '',
    keywordQuestion: obstacleData.valuesByCell.get('V7') || '',
    fullAnswer: obstacleData.valuesByCell.get('B8') || ''
  } : null;
  const finishRowStarts = [4, 12, 20, 28];
  const finishRounds = finishData ? finishRowStarts.map(startRow =>
    Array.from({ length: 7 }, (_, index) => {
      const row = startRow + index;
      return {
        question: finishData.valuesByCell.get(`C${row}`) || '',
        answer: finishData.valuesByCell.get(`D${row}`) || ''
      };
    })
  ) : null;
  const hasObstacleCourse = obstacleCourse && (obstacleCourse.rows.some(row => row.answer || row.question) || obstacleCourse.keyword || obstacleCourse.keywordQuestion || obstacleCourse.fullAnswer);
  const hasFinishRounds = finishRounds?.some(round => round.some(item => item.question || item.answer));
  if (!questions.length && !speedQuestions?.some(question => question.prompt || question.answer) && !hasObstacleCourse && !hasFinishRounds) {
    throw new Error('Không tìm thấy câu hỏi hoặc đáp án trong các ô đã chỉ định ở các sheet.');
  }
  return { questions, openingSheetIncluded: Boolean(openingData), bonusSheetIncluded: Boolean(bonusData), speedQuestions, obstacleCourse, finishSheetIncluded: Boolean(finishData), finishRounds };
};
