// A linked list. Each node points to the next node; the last node points to null.

class ListNode {
  value: number;
  next: ListNode | null = null;

  constructor(value: number) {
    this.value = value;
  }
}

class LinkedList {
  head: ListNode | null = null;
  size = 0;

  add(value: number): void {
    const node = new ListNode(value);
    if (this.head === null) {
      this.head = node;
    } else {
      let current = this.head;
      while (current.next !== null) {
        current = current.next;
      }
      current.next = node;
    }
    this.size++;
  }
}

const list = new LinkedList();
list.add(3);
list.add(5);
list.add(8);
console.log(list.size);
