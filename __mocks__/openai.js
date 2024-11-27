module.exports = {
  default: class OpenAI {
    constructor() {}
    chat: {
      completions: {
        create: jest.fn()
      }
    },
    models: {
      list: jest.fn()
    }
  }
}; 