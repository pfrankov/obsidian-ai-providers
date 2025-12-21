const getMockFn = () => {
  if (global.vi && typeof global.vi.fn === 'function') {
    return global.vi.fn();
  }
  return () => undefined;
};

module.exports = {
  default: class OpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: getMockFn()
        }
      };
      this.models = {
        list: getMockFn()
      };
    }
  }
}; 
