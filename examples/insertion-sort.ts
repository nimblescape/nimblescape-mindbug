// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Insertion sort. Step through the program and watch the array change.
// Both arr and arr2 point to the same array: the function changes the array in the heap.

function insertionSort(arr: number[]): void {
  for (let unsortedIndex = 1; unsortedIndex < arr.length; unsortedIndex++) {
    const unsortedValue = arr[unsortedIndex];
    let sortedIndex = unsortedIndex - 1;

    // Shift bigger values one place to the right
    while (sortedIndex > -1 && arr[sortedIndex] > unsortedValue) {
      arr[sortedIndex + 1] = arr[sortedIndex];
      sortedIndex--;
    }
    // Put the value in its place
    arr[sortedIndex + 1] = unsortedValue;
  }
}

const arr1 = [1, 2, 3];
const arr2 = [3, 7, 1, 5, -4, 6, 4, 2];
insertionSort(arr2);
console.log(arr1, arr2);
