module.exports = {
  content: ['./index.html', './app.js'],
  theme: { extend: {
    fontFamily: { sans: ['Nunito', 'sans-serif'] },
    colors: { brand: { 50:'#f0fdfa',100:'#ccfbf1',200:'#99f6e4',400:'#2dd4bf',500:'#14b8a6',600:'#0d9488',700:'#0f766e',900:'#134e4a' } },
    animation: { pop: 'pop 0.3s ease-out forwards' },
    keyframes: { pop: { '0%': { transform:'scale(0.95)',opacity:'0' }, '100%': { transform:'scale(1)',opacity:'1' } } }
  } }
};
