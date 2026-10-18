// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The life of one object: a function creates it and
// returns it. Use Step Into (F11) on the call of
// createBook, and Step Over (F10) on the other lines.
//
// 1. The call adds a scope on top of the Global scope,
//    with the parameters title and pages.
// 2. new Book(...) creates the object on the heap, and
//    the local variable book points to it.
// 3. createBook returns: its scope goes away. The
//    object stays, because myBook now points to it.
// 4. myBook = null: no variable points to the object
//    any more, so the view does not show it any more.
//    JavaScript frees its memory later.

class Book {
  title: string;
  pages: number;

  constructor(title: string, pages: number) {
    this.title = title;
    this.pages = pages;
  }
}

function createBook(title: string, pages: number): Book {
  const book = new Book(title, pages);
  return book;
}

let myBook: Book | null = createBook('TypeScript', 250);
console.log(myBook.title);
myBook = null;
console.log(myBook);
