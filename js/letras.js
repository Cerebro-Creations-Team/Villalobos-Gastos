// Importe con letra, en el formato que usa el comprobante de gastos:
// 115587.84 -> "CIENTO QUINCE MIL QUINIENTOS OCHENTA Y SIETE PESOS 84/100 MN"
(function (global) {
  const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
    'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO',
    'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO',
    'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
    'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  // 0..999
  function centenas(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100);
    const resto = n % 100;
    let txt = CENTENAS[c];
    if (resto) {
      let r;
      if (resto < 30) r = UNIDADES[resto];
      else {
        const d = Math.floor(resto / 10), u = resto % 10;
        r = DECENAS[d] + (u ? ' Y ' + UNIDADES[u] : '');
      }
      txt = (txt ? txt + ' ' : '') + r;
    }
    return txt;
  }

  function enteroALetras(n) {
    if (n === 0) return 'CERO';
    const millones = Math.floor(n / 1e6);
    const miles = Math.floor((n % 1e6) / 1000);
    const resto = n % 1000;
    const partes = [];
    if (millones) partes.push(millones === 1 ? 'UN MILLON' : enteroALetras(millones) + ' MILLONES');
    if (miles) partes.push(miles === 1 ? 'MIL' : centenas(miles) + ' MIL');
    if (resto) partes.push(centenas(resto));
    return partes.join(' ');
  }

  function importeConLetra(importe) {
    const centavosTotales = Math.round(Math.abs(importe) * 100);
    const pesos = Math.floor(centavosTotales / 100);
    const centavos = String(centavosTotales % 100).padStart(2, '0');
    const palabra = pesos === 1 ? 'PESO' : 'PESOS';
    // "UN MILLON PESOS" -> "UN MILLON DE PESOS"
    const de = pesos >= 1e6 && pesos % 1e6 === 0 ? 'DE ' : '';
    return `${enteroALetras(pesos)} ${de}${palabra} ${centavos}/100 MN`;
  }

  const api = { importeConLetra, enteroALetras };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Letras = api;
})(this);
