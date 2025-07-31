#!/usr/bin/env python3

def add(a, b):
    return a + b

def multiply(a, b):
    return a * b

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

def main():
    print("Calculator Demo")
    print(f"5 + 3 = {add(5, 3)}")
    print(f"4 * 7 = {multiply(4, 7)}")
    print(f"5! = {factorial(5)}")

if __name__ == "__main__":
    main()