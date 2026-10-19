import { describe, expect, it } from 'vitest';
import { looksLikeProjectRequest as looks } from '../intent';

describe('does a message point at the person’s project?', () => {
  it.each([
    'Fix the bug in src/auth/login.ts',
    'what does @server/chat.ts do',
    'Why does my project fail to build?',
    'find where the codebase handles retries',
    'run the tests and tell me what fails',
    'update package.json to add vitest',
    'git diff looks wrong, can you explain it',
    'Refactor this repo to use ESM',
    'look through the repository for TODOs',
    'open ./scripts/deploy.sh and explain it',
  ])('yes: %s', text => expect(looks(text)).toBe(true));

  it.each([
    'write a python function that reverses a string',
    'explain how Next.js routing works',
    'what is the difference between let and const?',
    'summarise this article for me',
    'hi',
    'Can you recommend a good project to learn Rust?',
    'here is my code:\n```js\nconst a = 1;\n```\nwhy is it slow?',
    'how do I run tests in general?',
    'tell me about node.js and vue.js',
    '',
  ])('no: %s', text => expect(looks(text)).toBe(false));
});

import { looksLikeNewProjectRequest as makes } from '../intent';

describe('does a message ask for something new to be built?', () => {
  it.each([
    'Build me a todo app',
    'create a website for my bakery with a menu page',
    'Can you make a Python script that renames my photos?',
    'please write a CLI tool that converts csv to json',
    'Make a simple snake game',
    "let's build a REST API in Go",
    'scaffold a React dashboard',
    'I want you to create a Discord bot',
  ])('yes: %s', text => expect(makes(text)).toBe(true));

  it.each([
    'how do I build an app with React?',
    'what is the best way to create a website',
    'Why is my build failing?',
    'write a function that reverses a string',
    'explain how to make a game in Unity',
    'summarise this article',
    'make me a sandwich',
    'create a new test file in my repo',
    '',
  ])('no: %s', text => expect(makes(text)).toBe(false));
});
