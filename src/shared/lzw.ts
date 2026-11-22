/**
 * LZW Codec for Test Drive III image format
 *
 * Decode based on TD3Extract reference implementation.
 * Encode mirrors the decoder's 9-12 bit variable-width stream:
 * - Codes packed little-endian / LSB-first in the bitstream
 * - 256: clear dictionary, 257: end of stream, 258: first dictionary entry
 * - Dictionary starts with single-byte entries 0-255
 * - After emit/add, code width expands when nextCodeId >= (1 << bitLength)
 */

// Constants
const RESET_DICTIONARY_MARKER = 0x100;  // 256 - Clear code
const END_OF_STREAM_MARKER = 0x101;     // 257 - End code
const FIRST_CODE = 0x102;               // 258 - First dictionary entry
const MAX_CODE_BIT_LENGTH = 12;
const MAX_DICTIONARY_SIZE = 4096;

/**
 * Decode LZW compressed data
 * @param data - Compressed input data
 * @returns Decompressed output data
 */
export function lzwDecode(data: Uint8Array): Uint8Array {
    const output: number[] = [];

    // Dictionary: code -> byte sequence
    let dictionary: Map<number, number[]> = new Map();
    let nextCodeId = FIRST_CODE;
    let currentCodeBitLength = 9;

    // Bit reading state
    let bitPosition = 0;

    // Initialize dictionary with single-byte entries (0-255)
    function resetDictionary(): void {
        dictionary = new Map();
        for (let i = 0; i < 256; i++) {
            dictionary.set(i, [i]);
        }
        nextCodeId = FIRST_CODE;
        currentCodeBitLength = 9;
    }

    // Read variable-width code from bit stream
    function readCode(): number | null {
        const bytePos = Math.floor(bitPosition / 8);
        const bitOffset = bitPosition % 8;

        // Need at least 2 bytes, potentially 3 for codes spanning byte boundaries
        if (bytePos + 2 > data.length) {
            return null;
        }

        // Read 24-bit window (handles all code sizes up to 16 bits)
        let value = data[bytePos];
        if (bytePos + 1 < data.length) {
            value |= data[bytePos + 1] << 8;
        }
        if (bytePos + 2 < data.length) {
            value |= data[bytePos + 2] << 16;
        }

        // Extract the code
        value >>= bitOffset;
        value &= (1 << currentCodeBitLength) - 1;

        bitPosition += currentCodeBitLength;
        return value;
    }

    // Check if we need to expand code width
    function checkCodeWidthExpansion(): void {
        if (nextCodeId >= (1 << currentCodeBitLength) && currentCodeBitLength < MAX_CODE_BIT_LENGTH) {
            currentCodeBitLength++;
        }
    }

    // Start with fresh dictionary
    resetDictionary();

    // Read first code
    let code = readCode();
    if (code === null || code === END_OF_STREAM_MARKER) {
        return new Uint8Array(output);
    }

    // Handle clear code at start
    if (code === RESET_DICTIONARY_MARKER) {
        resetDictionary();
        code = readCode();
        if (code === null || code === END_OF_STREAM_MARKER) {
            return new Uint8Array(output);
        }
    }

    // Output first code
    let prevSequence = dictionary.get(code);
    if (!prevSequence) {
        // Invalid first code
        return new Uint8Array(output);
    }
    output.push(...prevSequence);

    // Main decode loop
    while (true) {
        code = readCode();
        if (code === null) {
            break;
        }

        if (code === END_OF_STREAM_MARKER) {
            break;
        }

        if (code === RESET_DICTIONARY_MARKER) {
            resetDictionary();
            code = readCode();
            if (code === null || code === END_OF_STREAM_MARKER) {
                break;
            }
            prevSequence = dictionary.get(code);
            if (!prevSequence) {
                break;
            }
            output.push(...prevSequence);
            continue;
        }

        let currentSequence: number[];

        if (dictionary.has(code)) {
            // Code exists in dictionary
            currentSequence = dictionary.get(code)!;
        } else if (code === nextCodeId) {
            // Special case: code not yet in dictionary
            // This happens when encoder adds entry that decoder hasn't added yet
            currentSequence = [...prevSequence!, prevSequence![0]];
        } else {
            // Invalid code - shouldn't happen with valid data
            console.warn(`Invalid LZW code: ${code}, expected <= ${nextCodeId}`);
            break;
        }

        // Output the sequence
        output.push(...currentSequence);

        // Add new dictionary entry: previous sequence + first byte of current
        if (nextCodeId < MAX_DICTIONARY_SIZE) {  // Max dictionary size
            const newEntry = [...prevSequence!, currentSequence[0]];
            dictionary.set(nextCodeId, newEntry);
            nextCodeId++;
            checkCodeWidthExpansion();
        }

        prevSequence = currentSequence;
    }

    return new Uint8Array(output);
}

/**
 * Encode data using TD3's LZW variant.
 * Produces a bitstream compatible with {@link lzwDecode}.
 */
export function lzwEncode(data: Uint8Array): Uint8Array {
    if (data.length === 0) {
        return writeCodes([END_OF_STREAM_MARKER], [9]);
    }

    const codes: number[] = [];
    const widths: number[] = [];

    let dict = new Map<string, number>();
    let nextCodeId = FIRST_CODE;
    let currentCodeBitLength = 9;

    function resetDictionary(): void {
        dict = new Map<string, number>();
        // Prefill single-byte entries for lookup of multi-char strings starting/continuing.
        for (let i = 0; i < 256; i++) {
            dict.set(String.fromCharCode(i), i);
        }
        nextCodeId = FIRST_CODE;
        currentCodeBitLength = 9;
    }

    let pendingExpansion = false;

    function emit(code: number): void {
        codes.push(code);
        widths.push(currentCodeBitLength);
        // Expansion is delayed by one code: the decoder reads the triggering
        // code, adds the entry, bumps nbits, then reads the NEXT code at the
        // new width. So the code emitted immediately after the add uses the
        // old width; the following code uses the new width.
        if (pendingExpansion && currentCodeBitLength < MAX_CODE_BIT_LENGTH) {
            currentCodeBitLength++;
            pendingExpansion = false;
        }
    }

    function checkCodeWidthExpansion(): void {
        if (nextCodeId >= (1 << currentCodeBitLength) && currentCodeBitLength < MAX_CODE_BIT_LENGTH) {
            pendingExpansion = true;
        }
    }

    resetDictionary();
    // Emit initial CLEAR code for compatibility with TD3's decoder expectations.
    emit(RESET_DICTIONARY_MARKER);

    let w = String.fromCharCode(data[0]);

    for (let i = 1; i < data.length; i++) {
        const c = String.fromCharCode(data[i]);
        const wc = w + c;

        if (dict.has(wc)) {
            w = wc;
            continue;
        }

        // Emit code for w (using current bit width)
        const wCode = dict.get(w);
        if (wCode === undefined) {
            throw new Error('LZW encode: missing dictionary entry for current string');
        }
        emit(wCode);

        // Add wc to dictionary if space remains (mirrors decoder: stop adding at 4096)
        if (nextCodeId < MAX_DICTIONARY_SIZE) {
            dict.set(wc, nextCodeId);
            nextCodeId++;
            checkCodeWidthExpansion();
        }

        w = c;
    }

    const wCode = dict.get(w);
    if (wCode === undefined) {
        throw new Error('LZW encode: missing dictionary entry for final string');
    }
    emit(wCode);
    emit(END_OF_STREAM_MARKER);

    return writeCodes(codes, widths);
}

function writeCodes(codes: number[], widths: number[]): Uint8Array {
    let bitPosition = 0;
    for (let i = 0; i < widths.length; i++) {
        bitPosition += widths[i];
    }
    const out = new Uint8Array(Math.ceil(bitPosition / 8));
    bitPosition = 0;

    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        const width = widths[i];
        const bytePos = Math.floor(bitPosition / 8);
        const bitOffset = bitPosition % 8;

        // Write into little-endian 24-bit window
        let value = out[bytePos] | (out[bytePos + 1] << 8) | (out[bytePos + 2] << 16);
        value |= (code & ((1 << width) - 1)) << bitOffset;
        out[bytePos] = value & 0xff;
        if (bytePos + 1 < out.length) out[bytePos + 1] = (value >>> 8) & 0xff;
        if (bytePos + 2 < out.length) out[bytePos + 2] = (value >>> 16) & 0xff;

        bitPosition += width;
    }

    return out;
}
