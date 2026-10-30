import cv2
import numpy as np
from imutils.perspective import four_point_transform
from imutils import contours
import imutils
import sys

# --- Step 0: The "Pre-Trained Model" (Segment Lookup Table) ---
# A dictionary mapping the active segment pattern (0=off, 1=on) to the digit
# The order is: top, top-left, top-right, middle, bottom-left, bottom-right, bottom
DIGITS_LOOKUP = {
    (1, 1, 1, 0, 1, 1, 1): 0,
    (0, 0, 1, 0, 0, 1, 0): 1,
    (1, 0, 1, 1, 1, 0, 1): 2,
    (1, 0, 1, 1, 0, 1, 1): 3,
    (0, 1, 1, 1, 0, 1, 0): 4,
    (1, 1, 0, 1, 0, 1, 1): 5,
    (1, 1, 0, 1, 1, 1, 1): 6,
    (1, 0, 1, 0, 0, 1, 0): 7,
    (1, 1, 1, 1, 1, 1, 1): 8,
    (1, 1, 1, 1, 0, 1, 1): 9
}

# --- Step 1: Load and Pre-Process the Image ---
image_path = sys.argv[1]
image = cv2.imread(image_path)
if image is None:
    print("Error: Could not load image. Check the file path/name.")
    exit()

# Convert to grayscale and threshold to get the segments
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

cv2.imshow("gray Image", gray)
cv2.waitKey(0)
cv2.destroyAllWindows()

# GaussianBlur reduces noise, which is important for thresholding
blurred = cv2.GaussianBlur(gray, (5, 5), 0)

# Thresholding isolates the bright segments from the dark background
# **Tweak this value (200) based on your photo's brightness/contrast**
thresh = cv2.threshold(blurred, 100, 255, cv2.THRESH_BINARY_INV)[1]

cv2.imshow("Threshold Image", thresh)
cv2.waitKey(0)
cv2.destroyAllWindows()

# Closing
kernel = np.ones((7, 7), np.uint8)
thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

cv2.imshow("Closed Threshold Image (Check for 4 connected blobs)", thresh)
cv2.waitKey(0)
cv2.destroyAllWindows()

# --- Step 2: Find and Isolate Individual Digits ---
# Find contours in the thresholded image
cnts = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
cnts = imutils.grab_contours(cnts)
print(f"Total contours found (before filtering): {len(cnts)}")
digitCnts = []
decimalCnts = []

# Loop over the digit candidates
for c in cnts:
    # Compute the bounding box
    (x, y, w, h) = cv2.boundingRect(c)

    # print(f"Contour | X:{x}, Y:{y} | W:{w}, H:{h} | Aspect Ratio: {h/w:.2f}")
    
    if w >= 80 and (h >= 160 and h <= 200) and (h / w > 1.5 and h / w < 2.5):
        digitCnts.append(c)

    if w <= 40 and h <= 40 and w >= 5 and h >= 5: 
        # Check if the object is positioned low on the display
        # The decimal point should be near the bottom of the digit bounding box.
        # This is a general sanity check to eliminate small specks of noise elsewhere.
        if y > 0.7 * image.shape[0] / 2: # Check if Y is in the lower half of the display area
            decimalCnts.append(c)

all_contours = digitCnts + decimalCnts
# Sort the digits from left-to-right
sorted_contours = contours.sort_contours(all_contours, method="left-to-right")[0]
final_recognition_list = []

# --- Step 3: Segment Analysis and Recognition ---
for c in sorted_contours:
    # Extract the individual digit ROI (Region of Interest)
    (x, y, w, h) = cv2.boundingRect(c)

    # If the contour is small (decimal point)
    if w <= 40 and h <= 40: # Use the same size criteria as the decimal filter
        final_recognition_list.append('.')
        continue # Skip to the next contour

    roi = thresh[y:y + h, x:x + w]
    output = cv2.cvtColor(roi, cv2.COLOR_GRAY2BGR)
    
    # Define the 7 segment regions (ratios of the bounding box)
    (rH, rW) = roi.shape
    (dW, dH) = (int(rW * 0.3), int(rH * 0.1))
    
    # The segment coordinates (normalized to the digit's ROI)
    segments = [
        # top
        ((0, 0), (rW, dH)),
        # top-left
        ((0, 0), (dW, rH // 2)),
        # top-right
        ((rW - dW, 0), (rW, rH // 2)),
        # middle
        ((0, rH // 2 - dH // 2), (rW, rH // 2 + dH // 2)),
        # bottom-left
        ((0, rH // 2), (dW, rH)),
        # bottom-right
        ((rW - dW, rH // 2), (rW, rH)),
        # bottom
        ((0, rH - dH), (rW, rH))
    ]

    on = [0] * 7 # Array to store which segments are 'on'
    
    # Loop over the segments
    for (i, ((xA, yA), (xB, yB))) in enumerate(segments):
        cv2.rectangle(output, (xA, yA), (xB, yB), (0, 0, 255), 1)
        # Crop the segment region
        segROI = roi[yA:yB, xA:xB]
        total = cv2.countNonZero(segROI) # Count active pixels

        # If the number of active pixels is > 50% of the segment area, it's 'on'
        area = (xB - xA) * (yB - yA)
        if total / area > 0.5:
            on[i] = 1

    # Lookup the digit based on the segment pattern
    try:
        digit = DIGITS_LOOKUP[tuple(on)]
        print("digit: ", digit)
    except KeyError:
        digit = "?"
        
    final_recognition_list.append(str(digit))

    cv2.imshow(f"Digit {len(final_recognition_list) + 1} Segment Check", output)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

# --- Step 4: Output the Result ---
print("Recognized Number:", "".join(final_recognition_list))
