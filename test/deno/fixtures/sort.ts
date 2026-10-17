function insertionSort(arr: number[]): void {
  for (let unsortedIndex = 1; unsortedIndex < arr.length; unsortedIndex++) {
    const unsortedValue = arr[unsortedIndex];
    let sortedIndex = unsortedIndex - 1;
    while (sortedIndex > -1 && arr[sortedIndex] > unsortedValue) {
      arr[sortedIndex + 1] = arr[sortedIndex];
      sortedIndex--;
    }
    arr[sortedIndex + 1] = unsortedValue;
    if (unsortedIndex === 7) debugger;
  }
}

const arr1 = [1, 2, 3];
const arr2 = [3, 1, 4, 7, 5, 6, 3, -4];
insertionSort(arr2);
debugger;
console.log(arr1, arr2);
